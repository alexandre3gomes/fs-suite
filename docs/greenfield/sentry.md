# Greenfield — Sentry

Provisions the Sentry project that receives errors from both the NestJS
API and the Expo web bundle. We use a **single project** with both SDKs
attached — backend and frontend errors land in the same place and are
distinguishable by the `sdk` tag (`node` vs `javascript`) and by the
`release` field.

> **Reusing existing**: if a Sentry project for FS Suite exists and you
> have the DSN, skip to [Capture credentials](#capture-credentials).

## 1. Create the org (first time only)

If you don't have a Sentry account at all:

1. https://sentry.io/signup → sign up with your work email.
2. **Organization slug**: `fs-suite` (or your preferred org name).
3. **Plan**: Developer (free) — 5K errors/month, 10K performance events/month.
   Upgrade later if needed.

## 2. Create the project

1. **Projects → Create Project**.
2. **Platform**: Node.js (the dropdown forces a single choice; pick Node.
   You'll attach the browser SDK to the same project later via
   `EXPO_PUBLIC_SENTRY_DSN`).
3. **Alert frequency**: "On every new issue" is fine to start.
4. **Project name**: `fs-suite`
5. **Team**: default.
6. **Create Project**.

Sentry walks you through Node SDK setup — you can skip it (the SDK is
already integrated in `apps/api`).

## 3. Copy the DSN

1. **Project Settings → SDK Setup → Client Keys (DSN)**.
2. Copy the **DSN** value. It looks like:

   ```
   https://<key>@<org>.ingest.de.sentry.io/<project-id>
   ```

   The region (`de.` for EU, `us.` for US) is set by the org's data
   region — chosen at org creation, cannot be changed later.

## 4. Confirm the release tracking integration

The deploy workflow tags every event with the commit SHA so frontend and
backend errors can be correlated to a specific deploy.

- `apps/api/src/main.ts` reads `process.env.SENTRY_RELEASE` (set by
  `deploy.yml` and `deploy-app.yml` from the short / long commit SHA).
- `apps/app` reads `EXPO_PUBLIC_SENTRY_RELEASE` (set by `deploy-app.yml`).

No additional Sentry config required — release values are pure metadata
and need no Sentry-side setup. Optionally: install the GitHub integration
(**Settings → Integrations → GitHub**) so Sentry links stack traces to
commits.

## Capture credentials

Add to your canonical `.env`:

```bash
SENTRY_DSN=https://<key>@<org>.ingest.de.sentry.io/<project-id>
```

The same value reaches:

- **Backend**: via EC2 `.env` (propagated by `ec2/setup.sh`).
- **Frontend**: via the GitHub Secret `SENTRY_DSN` (pushed by
  `bootstrap-github-secrets.sh`), injected at Expo build time as
  `EXPO_PUBLIC_SENTRY_DSN`.

## Validation

After a deploy that includes the change:

1. Visit https://fs-suite.com and force a frontend error (open devtools,
   `throw new Error('test')` in console).
2. Force a backend error: `curl -X POST https://api.fs-suite.com/v1/auth/exchange`
   with bad payload.
3. Within 30s, both errors should appear in Sentry:
   - The frontend one tagged `sdk:javascript`
   - The backend one tagged `sdk:node`
   - Both tagged with the same `release` value (commit SHA).
