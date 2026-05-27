# Greenfield — Supabase

Provisions the production PostgreSQL database, the Supavisor session-mode
pooler used by the API, and the Storage bucket consumed by `db-backup.yml`.

> **Reusing existing**: if a Supabase project for FS Suite already exists
> and you have the connection string + service-role key, skip to
> [Capture credentials](#capture-credentials).

## 1. Create the project

1. Go to https://supabase.com/dashboard and sign in.
2. **New project**:
   - **Name**: `fs-suite-prod`
   - **Database password**: generate a strong one (the dashboard offers
     this) and save it to your password manager.
   - **Region**: `eu-central-1` (Frankfurt). Co-locate with Upstash to
     minimise cross-region latency.
   - **Pricing plan**: Free is fine for MVP; upgrade when DB > 250 MB or
     paused-after-1-week becomes a problem.
3. Wait ~2 minutes for provisioning.

## 2. Build the `DATABASE_URL`

We use the **Supavisor session-mode pooler** because:
- Supabase's direct endpoint is IPv6-only; EC2 and Cloud Run runtimes
  are IPv4-only.
- Session mode supports prepared statements and advisory locks, so Prisma
  Client and Prisma Migrate both work with a single connection string
  (no separate `DIRECT_URL` needed).

Get the URL:

1. Dashboard → **Project Settings** → **Database** → **Connection string**.
2. Choose **Connection pooler** → **Session** mode.
3. Copy the URL. It will look like:

   ```
   postgres://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true
   ```

4. Replace `<password>` with the database password from step 1.
5. Confirm the port is **5432** (not 6543 — that's transaction mode,
   which breaks Prisma).

## 3. Create the backup Storage bucket

The daily `db-backup.yml` workflow uploads `pg_dump` output to a private
Storage bucket. The workflow creates the bucket on first run, but you can
also pre-create it:

1. Dashboard → **Storage** → **New bucket**.
2. **Name**: `db-backups`
3. **Public**: off (the workflow uses the service-role key).
4. Create.

> Retention is enforced by the workflow itself (rolling 90 days). No
> server-side lifecycle rule is required.

## 4. Capture the service-role key

The service-role JWT is what `db-backup.yml` uses to upload to Storage.
**Never use this key in the API runtime** — it bypasses Row Level Security.

1. Dashboard → **Project Settings** → **API**.
2. Under **Project API keys**, copy the **`service_role` secret**. It
   starts with `eyJ`.

## Capture credentials

Add these to your canonical `.env`:

```bash
DATABASE_URL=postgres://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true
SUPABASE_SERVICE_ROLE_KEY=eyJ<...>
```

## Validation

```bash
# Connectivity (requires psql or any libpq client):
psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')" -c "SELECT version();"

# Service role key validity:
curl -s -H "apikey: $(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2-)" \
  "https://<ref>.supabase.co/storage/v1/bucket" | jq
```

Both should succeed. The first prints the Postgres version; the second
lists buckets (`db-backups` after first backup run).
