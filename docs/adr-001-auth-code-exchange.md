# ADR-001: Auth Code Exchange Flow

**Date:** 2026-05-17
**Status:** Accepted
**Supersedes:** Direct token transport in OAuth redirect URLs

## Context

The original authentication flow redirected users after OAuth with the access token in the URL query string (`?access_token=...`). On native, both access and refresh tokens were sent in the deep link URL. This exposed sensitive credentials to browser history, server logs, referrer headers, and any intermediate proxies.

## Decision

Replace direct token transport with a one-time auth code exchange pattern:

1. After OAuth callback, the backend generates a random code (32 bytes hex) and stores the token pair in Redis with a 60-second TTL.
2. The redirect URL contains only `?code=XXXXX` — no tokens in the URL.
3. The frontend exchanges the code via `POST /v1/auth/exchange`, which returns the access token in the JSON body and sets the refresh token as an `httpOnly; Secure; SameSite` cookie (web) or returns it in the JSON body (native, stored in SecureStore).
4. The code is deleted from Redis on first use (single-use, getDel).

## Consequences

- **Security**: No tokens appear in URLs, browser history, or referrer headers.
- **Latency**: One additional HTTP round-trip (code exchange POST), negligible in practice.
- **Redis dependency**: Auth code storage requires Redis availability during login. Redis is already required for rate limiting, so no new infrastructure dependency.
- **Native flow**: Deep links now carry only the code, not tokens. The app exchanges it via the same POST endpoint with `platform: "native"`.

## Endpoint

```
POST /v1/auth/exchange
Body: { code: string, platform?: "native" }
Response (web): { accessToken: string } + httpOnly refresh cookie
Response (native): { accessToken: string, refreshToken: string }
```
