# User feedback — feature specification

Lets an authenticated user report a bug or send a suggestion from anywhere in
the app, without leaving the screen they're on, optionally attaching
screenshots/documents. Admins triage, reply by email, and mark items resolved
from an in-app admin screen. This document is the contract to build against; it
resolves every open decision in the brief.

Status: **implemented.** Scope is exactly this feature; no FlightAware, social,
premium, real-time tracking, or other expansion. A few details landed slightly
differently from the original plan — noted inline below.

---

## 1. Decisions (open questions, resolved)

| Question | Decision | Why |
|----------|----------|-----|
| Where do attachments live? | **Cloudflare R2**, private, served only through an admin-gated streaming endpoint. Reuse the existing `R2StorageService` and the existing bucket (`R2_BUCKET_NAME`, today `fs-suite-charts`) under a `feedback/` key prefix. | R2 is already wired (`@aws-sdk/client-s3`, `src/r2/r2-storage.service.ts`), is on the free tier (10 GB, no egress fees), and the bucket is already private + API-fronted — same trust model the chart overlays use. No new bucket, no new env, web-first and reusable by a future mobile client. |
| Upload transport | **Multipart to our API** (`multipart/form-data`, `FileInterceptor`). Never the Supabase service role / R2 credentials in the frontend. All validation is server-side. | Brief requires "preferir upload via API, validação server-side"; keeps secrets server-only. |
| Attachment limits | **Max 3 files; max 5 MB per file; MIME allow-list:** `image/png`, `image/jpeg`, `image/webp`, `application/pdf`. | Enough for screenshots + a log/PDF; small enough to stay trivially inside R2 free tier and Resend payloads. |
| Anti-execution safety | Validate by **magic bytes** (not just the declared MIME); **re-encode images through `sharp`** (already a dep) to strip any embedded payload; reject anything that fails. Store with the validated content-type; serve with `Content-Disposition: attachment` and **never** `text/html`/inline. No public URL. | "Garantir que anexos não virem risco de execução de conteúdo arbitrário." |
| Does "resolved" email the user? | **No.** The user-facing email is the **admin reply** (`/reply`). Marking `RESOLVED` is internal triage state and sends nothing. If an admin wants to tell the user, they reply — replying is what notifies. | Avoids noise/double-emails; one clear user-facing channel. Documented per brief. |
| Email & consent | Feedback emails (admin notification + reply to user) are **transactional/operational**, so they **do not** check `marketingEmailConsent` and carry **no** unsubscribe link. | LGPD: support replies are legitimate operational communication, not marketing. |
| Sender domain | Reuse the Resend-verified `fs-suite.com` domain. From: **`FS Suite <feedback@fs-suite.com>`**, reply-to `feedback@fs-suite.com`. | Mirrors `metrics-digest.yml` (`metrics@fs-suite.com`); same verified domain. |

### Cost note (zero-cost-except-EC2 policy)

This feature introduces **no new paid resource**. It reuses the existing R2
bucket and Resend account, both on free tiers comfortably above expected
volume (attachments ≤ 15 MB per feedback; Resend free tier = 3k emails/mo).
Storage does grow with usage — bounded by the limits above and the LGPD
cleanup in §6. If feedback volume ever pushes R2 past the free tier, that's a
cost event to surface before it happens; no action needed at expected scale.

---

## 2. Data model (Prisma)

New enums, two models, and relations on `User`. Follows existing conventions
(`cuid()` ids, `@map` snake_case, `deletedAt` soft delete for LGPD).

```prisma
enum FeedbackType {
  BUG_REPORT
  SUGGESTION
}

enum FeedbackStatus {
  OPEN      // submitted, untouched
  ANSWERED  // admin replied (set automatically by /reply)
  RESOLVED  // admin closed it (set manually by /status)
}

model Feedback {
  id          String         @id @default(cuid())
  type        FeedbackType
  description String         // free text, required
  status      FeedbackStatus @default(OPEN)

  // Author. FK kept for joins, but email/name are snapshotted at submit time
  // so the record survives user rename / soft-delete (LGPD-consistent audit).
  userId         String  @map("user_id")
  user           User    @relation("FeedbackAuthor", fields: [userId], references: [id])
  reporterEmail  String  @map("reporter_email")
  reporterName   String  @map("reporter_name")

  // Admin response
  adminReply   String?   @map("admin_reply")
  repliedById  String?   @map("replied_by_id")
  repliedBy    User?     @relation("FeedbackResponder", fields: [repliedById], references: [id])
  repliedAt    DateTime? @map("replied_at")
  resolvedAt   DateTime? @map("resolved_at")

  attachments FeedbackAttachment[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@index([status, createdAt])
  @@map("feedback")
}

model FeedbackAttachment {
  id          String   @id @default(cuid())
  feedbackId  String   @map("feedback_id")
  feedback    Feedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)

  storageKey  String   @map("storage_key")  // R2 key, e.g. feedback/{feedbackId}/{id}-{safeName}
  fileName    String   @map("file_name")    // original, sanitized for display
  contentType String   @map("content_type") // validated MIME
  sizeBytes   Int      @map("size_bytes")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([feedbackId])
  @@map("feedback_attachments")
}
```

Add to `User`:

```prisma
  feedbacks       Feedback[] @relation("FeedbackAuthor")
  feedbackReplies Feedback[] @relation("FeedbackResponder")
```

**Migration:** `npx prisma migrate dev --name add_feedback` (timestamped folder,
e.g. `20260602xxxxxx_add_feedback`). Applied in prod by the deploy pipeline's
`prisma migrate deploy` step.

---

## 3. Backend (NestJS)

New module `src/feedback/`, registered in `AppModule`:

```
src/feedback/
  feedback.module.ts
  feedback.controller.ts        # user-facing
  feedback-admin.controller.ts  # admin-facing
  feedback.service.ts
  feedback-mailer.service.ts     # Resend send (see §4)
  attachments.service.ts         # validate + store/stream R2 objects
  dto/
    create-feedback.dto.ts
    reply-feedback.dto.ts
    update-feedback-status.dto.ts
    list-feedback.dto.ts          # query filters
```

Imports `PrismaModule`, `R2Module` (`R2StorageService`), `ActivityService`,
and `EmailModule` (extended to send — see §4). DTOs use `class-validator` +
`@ApiProperty*` like `create-flight-plan.dto.ts`.

### Endpoints

All under the global `/v1` prefix.

#### User (`@UseGuards(JwtAuthGuard)`)

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/feedback` | `multipart/form-data`: `type`, `description`, `files[]` (0–3) | `@CurrentUser()` → snapshot `reporterEmail`/`reporterName`. Validate DTO + each file (§ attachments). Create `Feedback` + `FeedbackAttachment` rows, put objects to R2. Log `feedback.created`. Email admins (§4). Returns `FeedbackDto`. |

`CreateFeedbackDto`: `type: FeedbackType` (`@IsEnum`), `description: string`
(`@IsString @MinLength(1) @MaxLength(5000)`). Files come via
`@UseInterceptors(FilesInterceptor('files', 3, { limits: { fileSize: 5*1024*1024 } }))`.

#### Admin (`@UseGuards(JwtAuthGuard, AdminGuard)`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/feedback?status=&type=` | List non-deleted, newest first. Optional filters. Returns list of `FeedbackDto` (with `attachmentCount`, without admin internals beyond status). |
| GET | `/admin/feedback/:id` | Detail incl. description, attachments metadata (+ per-attachment image URL), existing reply. |
| POST | `/admin/feedback/:id/reply` | Body `{ message }` (`@IsString @MinLength(1)`). Persist `adminReply`, `repliedById = @CurrentUser().id`, `repliedAt = now`, set `status = ANSWERED` (unless already `RESOLVED`). Email the **user** (§4). Log `feedback.answered`. |
| PATCH | `/admin/feedback/:id/status` | Body `{ status: FeedbackStatus }`. Set status; if `RESOLVED` set `resolvedAt`. **No email.** Log `feedback.resolved` (or `feedback.reopened`). |
| GET | `/admin/feedback/:id/attachments/:attachmentId` | **Admin-gated** stream of the R2 object. `Content-Disposition: attachment; filename=...`, validated content-type, `Cache-Control: private, no-store`. Mirrors `chart-overlays/:id/image` but never `@Public()`. |

### Attachments service (validation + storage)

On upload, per file:
1. Enforce count ≤ 3 and size ≤ 5 MB (also enforced by the interceptor).
2. Sniff **magic bytes** and require they match an allow-listed type:
   `PNG (89 50 4E 47)`, `JPEG (FF D8 FF)`, `WEBP (RIFF…WEBP)`, `PDF (%PDF-)`.
   The sniffed type is **authoritative** — the client-declared `mimetype` is not
   trusted (it can be spoofed or absent), so we derive the stored content-type
   from the bytes and reject anything that doesn't sniff to an allow-listed type.
3. For images: re-encode through `sharp` (already a dep) to its own format —
   this strips any embedded/polyglot payload and proves it's a real raster.
   PDFs: keep as-is after header check (no rasterization needed).
4. Sanitize `fileName` (strip path separators, control chars; cap length).
5. `R2StorageService.putObject('feedback/{feedbackId}/{attachmentId}-{safeName}', buf, contentType)`.

Streaming back: `R2StorageService.getObject(storageKey)` → pipe to response with
`attachment` disposition; 404 if missing. Never serve inline / as HTML.

### Shared admin-recipients helper (DRY)

The "effective admins = `User.isAdmin ∪ ADMIN_EMAILS`" union currently lives
inline in `admin.controller.ts`. Extract it into a reusable function/service
(e.g. `auth/admin-recipients.ts` taking `PrismaService`, or a method on a small
`AdminRecipientsService`) and call it from **both** the metrics endpoint and the
feedback mailer, so the recipient list has one source of truth. Refactor is
behavior-preserving for `/v1/admin/metrics`.

---

## 4. Email (Resend)

> **As built:** sending is centralized in `EmailModule`'s **`MailerService`**,
> which uses the `resend` SDK (already a dep). `FeedbackMailerService` only builds
> the HTML and calls `mailer.send(...)`. Crucially, `MailerService` only sends
> via Resend when `NODE_ENV === 'production'` — **outside production it captures
> the email into an in-memory dev inbox instead of sending** (no real mail, no
> cost). View captured emails (exact HTML, isolated in an iframe) at
> `GET /v1/dev/emails` (dev-only, 404 in prod). Force a real send from a non-prod
> env with `MAIL_FORCE_SEND=true` (requires `RESEND_API_KEY`). This applies to
> **every** email the API sends — feedback admin notification and reply alike.

`FeedbackMailerService`:

```ts
send({ to, subject, html, replyTo }): Promise<void>
```

- `from`: `FEEDBACK_EMAIL_FROM` env, default `FS Suite <feedback@fs-suite.com>`.
- Fail soft + log (don't fail the user's POST if the admin email bounces); the
  feedback row is the source of truth, email is best-effort. Reply email failures
  to the user **should** surface to the admin (return non-2xx on `/reply`) so
  they know it didn't go out.

### Two flows

1. **Feedback created → admins.** To = shared admin-recipients list.
   Subject `[FS Suite] Novo {Reporte de erro|Sugestão} — {reporterName}`.
   Body: type, reporter name/email, full description, attachment count, and a
   link to `/admin/feedback/{id}`. Operational — no consent check, no unsubscribe.
2. **Admin reply → user.** To = `reporterEmail`. Subject
   `Resposta ao seu feedback — FS Suite`. Body: light theme matching the metrics
   digest signature style; shows the user's original message (quoted) + the admin
   reply. Transactional — no consent check, no unsubscribe, no attachment links.
   **Signature is per-replier:** the footer uses the replying admin's own name;
   the title is `Founder & Lead Engineer | FS Suite` for the founder account
   (`FEEDBACK_SIGNATURE_FOUNDER_EMAIL`) and `Administration team | FS Suite` for
   any other admin. Logo + GitHub are shared (all env-overridable). The
   admin-notification email uses a neutral brand footer (no person).

Env: reuses `RESEND_API_KEY`, `ENCRYPTION_KEY` (already present). Optional new
`FEEDBACK_EMAIL_FROM` (has a default). No other new variables.

---

## 5. Frontend (Expo / React Native Web)

### Entry point — header button

`src/components/AppHeader.tsx`: add a discreet icon button left of the avatar,
authenticated views only. Icon: `Feather name="message-circle"` (the
`@expo/vector-icons` set already used in `admin/users.tsx`). Pressing it sets
local `feedbackOpen` state — **no navigation**, so the user's current screen and
in-progress work are untouched.

### `FeedbackModal`

`src/components/feedback/FeedbackModal.tsx`, opened over the current screen
(react-native `Modal`, `transparent`, `animationType="fade"`, backdrop closes —
same pattern as the header menu and `@fs-suite/ui` `Select`). Contents, all from
`@fs-suite/ui`:

- **`Select`** — tipo de contato: `Reportar erro` / `Enviar sugestão` (maps to `BUG_REPORT` / `SUGGESTION`).
- **`Input` `multiline`** — descrição (required; submit disabled while empty).
- **Attachment picker** — `expo-document-picker` (`getDocumentAsync`,
  `multiple: true`, `type: ['image/png','image/jpeg','image/webp','application/pdf']`).
  Works on web and native. Show selected files as chips with a remove (×);
  enforce the 3-file / 5-MB / MIME limits client-side too, with a clear pt-BR
  message on violation.
- **Buttons** — `Enviar` (loading spinner while posting) and `Cancelar`.
- **Result** — on success, swap the form for an inline confirmation inside the
  modal (`Obrigado pelo seu feedback!`); on error, inline pt-BR error, form kept
  so nothing is lost. Closing never discards the underlying screen.

### Service

`src/services/feedback.service.ts`, mirroring `users-admin.service.ts`:

```ts
feedbackApi.submit(form: FormData): Promise<FeedbackDto>      // multipart, Bearer via apiClient
feedbackApi.listAdmin(filters?): Promise<FeedbackDto[]>
feedbackApi.getAdmin(id): Promise<FeedbackDetailDto>
feedbackApi.reply(id, message): Promise<FeedbackDto>
feedbackApi.setStatus(id, status): Promise<FeedbackDto>
attachmentImageUrl(id, attachmentId): string                 // for admin <Image>/link
```

`submit` posts `FormData` with the JWT (extend `api.client.ts` with a multipart
helper or use `rawPost`; base URL from `EXPO_PUBLIC_API_URL`).

### Admin screens

Mirror the existing `admin/users.tsx` structure and the same `isAdmin` gate
(`useCurrentUser()` → `<Redirect href="/(auth)/dashboard" />` when not admin).

- `app/(auth)/admin/index.tsx` — add a `Card`/`Pressable` "Feedback dos usuários"
  linking to the list.
- `app/(auth)/admin/feedback/index.tsx` — list: each row a `Card` with type,
  reporter, date, and a status `Badge` (Aberto / Respondido / Resolvido). Optional
  status filter. Tap → detail.
- `app/(auth)/admin/feedback/[id].tsx` — detail: description, attachments
  (thumbnails for images via the admin image URL, link/icon for PDFs), an `Input`
  multiline + `Enviar resposta`, and a `Marcar como resolvido` button. Errors via
  `Alert.alert` (the app's existing feedback mechanism — no toast lib).

### i18n

Add namespaced keys to **both** `src/messages/pt-BR.json` and `en.json`
(parity is enforced): `feedback.*` (button label, modal title, type options,
description placeholder, attach/limits messages, submit/cancel, success/error)
and `admin.feedback.*` (card label, list title, empty/error, status badges,
reply field, send/resolve actions). pt-BR is the source of truth for wording.

### New dependency

`expo-document-picker` (app). No new runtime cost. API needs `multer` +
`@types/multer` for `FilesInterceptor` if not already transitively present via
`@nestjs/platform-express`.

---

## 6. LGPD & lifecycle (cleanup owner defined at design time)

- **Soft delete:** `Feedback.deletedAt`; lists/detail filter it out.
- **Attachment GC — owner = `RetentionService.purgeResolvedFeedbackAttachments()`**
  (daily cron). It deletes the R2 objects + `FeedbackAttachment` rows for any
  feedback that's been `RESOLVED` for more than 90 days. The `Feedback` row stays
  (audit), minus its now-unneeded heavy blobs. DB rows also cascade-delete with
  the parent (`onDelete: Cascade`) if a feedback is ever hard-deleted.
- **PII:** feedback rows keep snapshotted `reporterEmail`/`reporterName` for
  audit; attachments are private and admin-gated.
- **Email content:** no attachment links in emails; the user reply email
  contains only the user's own message + the admin reply. Admin notification
  contains the description (operational necessity) and goes only to admins.

---

## 7. Activity log events

Via `ActivityService.log(action, userId, metadata)`, matching the existing
`domain.verb` convention:

- `feedback.created` — `{ feedbackId, type, attachmentCount }`
- `feedback.answered` — `{ feedbackId, repliedById }`
- `feedback.resolved` / `feedback.reopened` — `{ feedbackId, by }`

---

## 8. Docs & config to update at implementation time

- `docs/technical-spec.md` — add the `feedback` module: models, endpoints, email
  flows, attachment storage decision (this doc is the long form; cross-link it).
- `infra/README.md` — note the reused R2 bucket `feedback/` prefix and the
  `feedback@fs-suite.com` sender; no new bucket/policy.
- `.env.example.production`, `apps/api/.env.example`, `infra/ec2/.env.example` —
  add `FEEDBACK_EMAIL_FROM` (optional, documented default). **No** other new vars.
- Per the docs-in-same-commit rule, all of the above land with the code, not in a
  follow-up.
- **Do not** remove any existing Resend configuration.

---

## 9. Acceptance criteria (from the brief, mapped)

- [ ] Authenticated user opens feedback from the header on any authenticated
      screen, modal over current screen, **no navigation / no lost context**.
- [ ] User submits a bug/suggestion with required description + attachments within
      limits (3 × 5 MB, allow-listed MIME), validated server-side.
- [ ] Admins receive an email when feedback is created (recipients = shared
      `User.isAdmin ∪ ADMIN_EMAILS`).
- [ ] Admin sees the list, opens detail (description + attachments), replies, and
      marks resolved.
- [ ] User receives the admin reply by email (transactional, no consent gate).
- [ ] Data persisted with auditable status + timestamps; soft delete; attachments
      private and admin-gated.
- [ ] LGPD-respecting, admin/user separation enforced by guards, web-first and
      reusable by a future mobile client.

---

## 9b. Local testing (object storage)

`docker compose up -d` starts a **MinIO** container that stands in for R2. The
API points at it via `R2_ENDPOINT=http://localhost:9000` (path-style forced for
non-AWS S3). Attachments and chart overlays therefore work end-to-end locally
without real R2 and without touching the API's disk — the same
`@aws-sdk/client-s3` code path runs. Buckets are auto-created by `minio-setup`.
Because attachment storage is **required** (§1), submitting feedback with files
fails loudly if MinIO/R2 is down — exactly the prod behaviour.

**Email previews (no real send locally):** outside production, `MailerService`
captures every email instead of sending it. Open **http://localhost:3001/v1/dev/emails**
to see the rendered HTML of the admin notification and the reply. So replying to
feedback works end-to-end locally (reply persists, status → `ANSWERED`) without
sending real mail — and you can eyeball exactly what the user would receive.

## 10. Validation before merge

- `pnpm --filter @fs-suite/api lint && pnpm --filter @fs-suite/api typecheck`
- `pnpm --filter @fs-suite/app lint && pnpm --filter @fs-suite/app typecheck`
- Focused tests: attachment validation (magic-byte accept/reject, oversize,
  count), admin-recipients union, status/reply state transitions.
- Manually verify the modal does **not** navigate away (context preserved).
- Migration coherence: `prisma migrate deploy` clean against a fresh DB; document
  the `migrate dev --name add_feedback` command in the PR.
