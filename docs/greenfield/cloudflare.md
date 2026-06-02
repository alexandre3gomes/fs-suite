# Greenfield — Cloudflare

Provisions everything that lives on Cloudflare: the DNS zone, the Pages
project for the web frontend, the R2 bucket for chart-overlay cache, and
the Origin Certificate used by nginx on EC2 for TLS termination.

> **Reusing existing**: if `fs-suite.com` is already on the Cloudflare
> account and the Pages project + R2 bucket already exist, skip to
> [Capture credentials](#capture-credentials).

## 1. Add the zone

1. Cloudflare dashboard → **Add a Site** → enter `fs-suite.com`.
2. **Plan**: Free is sufficient.
3. Cloudflare scans your existing DNS — review and import.
4. At your domain registrar, change the nameservers to the two Cloudflare
   ones shown. Propagation: minutes to hours.
5. After activation, set **SSL/TLS → Overview → Full (Strict)**.

## 2. DNS records

Create the following records (all proxied, the orange cloud is on):

| Record                          | Type   | Target                                    | Proxy   |
|---------------------------------|--------|-------------------------------------------|---------|
| `fs-suite.com`                  | CNAME  | `fs-suite-app.pages.dev`                  | Proxied |
| `www.fs-suite.com`              | CNAME  | `fs-suite.com`                            | Proxied |
| `api.fs-suite.com`              | A      | EC2 Elastic IP                            | Proxied |

> The Pages CNAME target (`fs-suite-app.pages.dev`) only exists after the
> Pages project is created (step 4 below). Create the DNS record afterwards.

## 3. Origin Certificate (for EC2 TLS)

EC2 terminates TLS using a Cloudflare Origin Certificate so the edge can
run in **Full (Strict)** mode.

1. Cloudflare dashboard → **SSL/TLS → Origin Server → Create Certificate**.
2. **Hostnames**: `api.fs-suite.com` (just the API host; the apex is served
   by Pages, which has its own cert).
3. **Validity**: 15 years.
4. **Key format**: PEM.
5. Click **Create**.
6. Cloudflare shows the certificate and private key **once** — save to
   your password manager. The provisioning scripts expect them as files
   named exactly:

   ```
   origin.pem        # certificate
   origin-key.pem    # private key
   ```

   When re-provisioning EC2, place these two files alongside `.env` and
   `ec2/setup.sh` will pick them up automatically.

## 4. Pages project (web frontend)

The frontend is built and deployed by `.github/workflows/deploy-app.yml`
on every push to `main` that touches `apps/app/**`.

You can let the workflow create the project on first run (it does
`wrangler pages project create` with `|| true`). To create manually:

1. Cloudflare dashboard → **Workers & Pages → Create application → Pages →
   Connect to Git**. (Optional — the workflow uses direct upload, so a Git
   connection is not required.)
2. Or, after the first workflow run, the project `fs-suite-app` appears
   under **Workers & Pages**.

Production-branch deploys come from `main` (`deploy-app.yml`); preview
deploys are not configured.

## 5. R2 bucket (chart cache)

1. Cloudflare dashboard → **R2 → Create bucket**.
2. **Name**: `fs-suite-charts`
3. **Location**: leave on Automatic (Cloudflare picks based on access pattern).
4. Create.

Then create an API token scoped to that bucket:

1. R2 dashboard → **Manage R2 API Tokens → Create API token**.
2. **Permissions**: Object Read & Write.
3. **Specify buckets**: `fs-suite-charts` only.
4. **TTL**: forever (or rotate annually).
5. **Create**.
6. Copy the **Account ID**, **Access Key ID**, and **Secret Access Key**.

## 6. Account-level token (for GitHub Actions)

A separate, broader token is needed for the workflow that deploys Pages.

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token**.
2. Use the **Custom Token** template with permissions:
   - **Account → Cloudflare Pages → Edit**
   - **Zone → DNS → Read** (lets wrangler auto-resolve the zone)
3. **Account Resources**: include the FS Suite account.
4. **Zone Resources**: include `fs-suite.com`.
5. **TTL**: forever.
6. **Continue → Create**.
7. Copy the token — you only see it once.

The **Account ID** is in the Cloudflare dashboard sidebar (right column,
just the hex string).

## Capture credentials

Add to your canonical `.env`:

```bash
# R2 (cat A — API runtime)
R2_ACCOUNT_ID=<32-char hex from R2 token>
R2_ACCESS_KEY_ID=<from R2 token>
R2_SECRET_ACCESS_KEY=<from R2 token>
```

Add to **GitHub Secrets** (cat C — pipeline auth, not in `.env`):

```
CLOUDFLARE_API_TOKEN=<account-level token from step 6>
CLOUDFLARE_ACCOUNT_ID=<account ID from sidebar>
```

The Origin Certificate (`origin.pem`, `origin-key.pem`) is not in `.env`
— it stays as two PEM files in your password manager.

## Validation

```bash
# DNS resolution (proxied — should return Cloudflare IPs, not your EC2 IP)
dig +short fs-suite.com
dig +short api.fs-suite.com

# TLS chain (should show "Cloudflare Inc ECC CA-3" or similar)
curl -vI https://api.fs-suite.com/v1/health 2>&1 | grep -E "issuer|subject"

# R2 connectivity (via AWS SDK; works because R2 speaks S3 API)
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
aws s3 ls "s3://fs-suite-charts" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
```
