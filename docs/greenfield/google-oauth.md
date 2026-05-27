# Greenfield — Google OAuth

Provisions the OAuth 2.0 client used for "Sign in with Google" on the FS
Suite frontend.

> **Reusing existing**: if you already have a Google OAuth client for FS
> Suite with prod redirect URIs configured, skip to
> [Capture credentials](#capture-credentials).

## Prerequisite

A GCP project. If you're following the runbook order in
[README.md](README.md), the project from [gcp.md](gcp.md) is reused here
— OAuth clients live under a GCP project but are conceptually a separate
concern (you can also create OAuth clients in a stand-alone "API project"
without Cloud Run).

## 1. Configure the OAuth consent screen

1. https://console.cloud.google.com/apis/credentials/consent (with project
   `fs-suite` selected).
2. **User type**: External.
3. **App information**:
   - **App name**: `FS Suite`
   - **User support email**: yours
   - **App logo**: optional
4. **App domain**:
   - **Application home page**: `https://fs-suite.com`
   - **Application privacy policy link**: link to your privacy page (e.g.
     `https://fs-suite.com/privacy`)
   - **Application terms of service link**: link to your ToS
5. **Authorized domains**: `fs-suite.com`
6. **Developer contact**: your email
7. **Scopes**: add `.../auth/userinfo.email` and `.../auth/userinfo.profile`
   (the FS Suite API only reads email and basic profile).
8. **Test users**: while in test mode, add the emails of testers (yours
   first). Skip this when you submit for verification.
9. Save and continue.

> You can leave the app in **Testing** mode indefinitely — Google caps you
> at 100 test users but doesn't expire. For >100 users you need to submit
> for verification (forms, security review). Not a day-1 blocker.

## 2. Create the OAuth client

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. **Application type**: Web application
3. **Name**: `fs-suite-prod`
4. **Authorized JavaScript origins**:
   - `https://fs-suite.com`
   - `https://www.fs-suite.com`
   - `http://localhost:3000` (for local dev — the Expo web dev server)
5. **Authorized redirect URIs**:
   - `https://api.fs-suite.com/v1/auth/google/callback`
   - `http://localhost:3001/v1/auth/google/callback` (for local API dev)
6. **Create**.
7. Copy **Client ID** and **Client Secret** from the modal.

## Capture credentials

Add to your canonical `.env`:

```bash
GOOGLE_CLIENT_ID=<numeric>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-<secret>
```

> `GOOGLE_CALLBACK_URL` is not in the `.env` — it's set to
> `https://api.fs-suite.com/v1/auth/google/callback` automatically by the
> EC2 and Cloud Run setup scripts (production hostname is fixed).

## Validation

After deploy, sign in at https://fs-suite.com. The flow should:

1. Redirect to Google, ask for permission once.
2. Redirect back to `api.fs-suite.com/v1/auth/google/callback`.
3. Set a refresh-token httpOnly cookie + grant an access token.
4. Land you on the dashboard.

If the redirect URI doesn't match exactly, Google shows
`redirect_uri_mismatch`. Re-check step 2.5 above.
