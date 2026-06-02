# Monitoring — UptimeRobot

The smoke-test GitHub workflow runs once a day and catches passive
breakage between deploys (expired certs, quota throttling, Cloudflare
drift). That's the minimum bar — a daily cadence cannot replace real
uptime monitoring. **UptimeRobot** fills the gap: external probes every
5 minutes, multi-region, free, with email/SMS/Slack alerts.

This is set up entirely in the UptimeRobot dashboard. No code changes
in this repo are required.

## 1. Create the account

1. https://uptimerobot.com/signUp — free plan: 50 monitors, 5-minute
   intervals, no credit card.
2. Verify email.

## 2. Configure the 3 monitors

Create one HTTP(s) — Keyword monitor per hostname.

### Monitor 1 — API primary (EC2)

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) — Keyword |
| Friendly Name | `fs-suite · api` |
| URL | `https://api.fs-suite.com/v1/health` |
| Keyword Type | exists |
| Keyword Value | `"status":"ok"` |
| Monitoring Interval | 5 minutes |
| HTTP Method | GET |
| Custom HTTP Headers | (none — the endpoint is public) |
| Alert Contacts | your default email (plus Slack/SMS if configured) |

> **Note (2026-06):** a second monitor for the Cloud Run candidate
> (`api-candidate.fs-suite.com`) used to live here. The candidate was
> decommissioned — delete that UptimeRobot monitor if it still exists.

### Monitor 2 — Frontend (Cloudflare Pages)

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) — Keyword |
| Friendly Name | `fs-suite · frontend` |
| URL | `https://fs-suite.com/` |
| Keyword Type | exists |
| Keyword Value | `<!DOCTYPE html` |
| Monitoring Interval | 5 minutes |

(Use a Keyword monitor rather than plain HTTP so a serving-but-empty
Pages bundle is also flagged.)

## 3. Alert contacts

UptimeRobot prefers a contact channel per severity. Recommended setup:

| Channel | Setup | Use for |
|---|---|---|
| Email (default) | Already configured at signup | All alerts |
| Slack | UptimeRobot → My Settings → Add Alert Contact → Slack webhook | Real-time team awareness (optional) |
| Voice call / SMS | Paid tier only | Critical pages (only if you go paid) |

Configure each monitor's "Alert Contacts" to include the email channel
at minimum.

## 4. Public status page (optional)

UptimeRobot's free tier includes a public status page:

1. Dashboard → **Status Pages → Add New Status Page**.
2. **Friendly Name**: `FS Suite Status`
3. **Custom Domain**: `status.fs-suite.com` (requires a CNAME in
   Cloudflare to UptimeRobot's status-page host).
4. **Monitors**: add all three.
5. Visibility: Public.

Skip this initially — useful once you have external users.

## 5. Validation

Right after creating each monitor, UptimeRobot probes immediately and
displays the status. All three should turn green within ~30s. If any
sits in "pending" or goes red:

- Check the Keyword Value matches the body literally (smart quotes vs
  straight quotes are a common gotcha).
- The 3 hostnames are proxied via Cloudflare — UptimeRobot's probes
  will reach Cloudflare edges, not your origin directly. If Cloudflare
  is blocking the probe (unlikely on default rules), exempt
  UptimeRobot's IP ranges in Cloudflare's WAF rules.

## Relationship to the GitHub smoke-test workflow

UptimeRobot and `.github/workflows/smoke-test.yml` cover overlapping
but complementary surfaces:

| Tool | Cadence | Cost | Failure mode |
|---|---|---|---|
| GH smoke-test (daily) | Once a day | Free | Opens a GitHub issue, emails subscribers |
| GH smoke-test (post-deploy) | After each deploy | Free | Fails the deploy workflow |
| UptimeRobot | Every 5 minutes | Free | Email / Slack / SMS alert |

Don't disable the GitHub workflows just because UptimeRobot is set up —
they catch deploy-induced regressions immediately, while UptimeRobot's
5-minute interval would only notice after the next probe.
