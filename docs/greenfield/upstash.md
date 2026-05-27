# Greenfield — Upstash Redis

Provisions the serverless Redis instance used for refresh-token sessions,
SimBrief import dedup, and other ephemeral state.

> **Reusing existing**: if you already have an Upstash database for FS
> Suite and the `rediss://` URL in your password manager, skip to
> [Capture credentials](#capture-credentials).

## 1. Create the database

1. Go to https://console.upstash.com/ and sign in.
2. **Create Database**:
   - **Name**: `fs-suite-prod`
   - **Type**: Regional (Global is overkill for our usage and ~2x cost)
   - **Region**: choose the EU region closest to Supabase. As of writing,
     `eu-west-1` (Ireland) is the safe pick — Upstash's Frankfurt option
     comes and goes between plans.
   - **TLS**: enabled (it is by default; double-check)
   - **Eviction**: `allkeys-lru` is the FS Suite default — works for the
     session cache and won't blow up if we hit the memory cap.
3. **Create**.

## 2. Capture the connection URL

1. After creation, open the database details page.
2. Under **Connect to your database**, select **redis-cli** (or
   "rediss://" depending on the UI version).
3. Copy the full URL. It looks like:

   ```
   rediss://default:<password>@<host>.upstash.io:6379
   ```

   The `rediss://` (two `s`) is important — that's TLS. Plain `redis://`
   sends auth in cleartext.

## Capture credentials

Add to your canonical `.env`:

```bash
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379
```

## Validation

```bash
# If you have redis-cli installed locally:
redis-cli -u "$(grep '^REDIS_URL=' .env | cut -d= -f2- | tr -d '"')" PING
# Expected: PONG

# Or via Node:
node -e '
const { createClient } = require("redis");
const c = createClient({ url: process.env.REDIS_URL });
c.on("error", e => { console.error(e); process.exit(1); });
(async () => { await c.connect(); console.log(await c.ping()); await c.quit(); })();
' REDIS_URL="$(grep '^REDIS_URL=' .env | cut -d= -f2- | tr -d '"')"
```

## Quotas you'll hit first

Free tier: 256 MB storage and 500K commands/day. The daily Metrics Digest
includes Redis used-memory vs. cap and total keys (see `infra/README.md`
→ Metrics Digest). Watch the trend; upgrade to pay-as-you-go before you
hit 80% memory or the command quota starts throttling.
