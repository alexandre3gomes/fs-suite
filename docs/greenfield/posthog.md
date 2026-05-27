# Greenfield — PostHog

Provisions the PostHog project that receives product analytics events
from the Expo web frontend. **PostHog is frontend-only** for FS Suite —
the NestJS API does not call PostHog.

> **Reusing existing**: if a PostHog project for FS Suite exists and you
> have the `phc_` project API key, skip to
> [Capture credentials](#capture-credentials).

## 1. Create the org / project

If you don't have a PostHog account:

1. https://app.posthog.com/signup → sign up.
2. **Region**: PostHog runs separate clusters for **US** (`app.posthog.com`)
   and **EU** (`eu.posthog.com`). Pick **EU** for FS Suite to keep
   user-event data inside the EU.
3. **Project name**: `fs-suite`
4. **Plan**: Free is fine to start (1M events/month).

## 2. Capture the project API key

1. **Project Settings → Project API Key**.
2. Copy the value — it starts with `phc_`.

This key is **designed to be public** (embedded in client bundles).
PostHog explicitly markets it as a project-scoped, ingest-only key —
worst case an attacker can spam events into your project. They cannot
read user data, modify settings, or touch other projects.

> Do not confuse with the **Personal API Key** (`phx_` prefix), which is
> server-side and read/write. We don't use that one.

## 3. Configure ingestion host (EU only)

The PostHog SDK in `apps/app/src/services/analytics.ts` hardcodes the
ingestion host to `https://eu.i.posthog.com`. If you picked the US
region in step 1, update that file to `https://us.i.posthog.com`. The
SDK won't auto-detect.

```typescript
// apps/app/src/services/analytics.ts
posthog = new PostHog(key, {
  host: 'https://eu.i.posthog.com', // ← change to us.i.posthog.com if your project is on US
});
```

## 4. LGPD / consent (later)

For Brazilian users (LGPD scope), PostHog should be opt-in. The current
`analytics.ts` exposes `posthog.optIn()` and `posthog.optOut()` —
wire them to a consent banner before public launch. Not a day-1 blocker
for testing.

## Capture credentials

Add to your canonical `.env`:

```bash
EXPO_PUBLIC_POSTHOG_KEY=phc_<key>
```

`bootstrap-github-secrets.sh` pushes this to the GitHub Secret
`POSTHOG_KEY`. `deploy-app.yml` then injects it at Expo build time so the
web bundle has the key embedded.

## Validation

After a deploy:

1. Visit https://fs-suite.com.
2. PostHog dashboard → **Live events** (left nav).
3. Within ~10s of any interaction (page view, click), events should
   appear with `$current_url: https://fs-suite.com/...`.

If no events arrive, check:

- `view-source:https://fs-suite.com` — search for `phc_`. If absent, the
  GH Secret wasn't injected at build time.
- Browser devtools → Network → filter `i.posthog.com`. If the requests
  are blocked, an ad blocker is interfering (PostHog hosts a proxy mode
  for this; not configured for FS Suite yet).
