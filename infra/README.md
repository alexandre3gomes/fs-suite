# Infrastructure — FS Suite

Kubernetes manifests for production deployment, organized with [Kustomize](https://kustomize.io/).

> Cluster bootstrap (K3s install, node setup, firewall rules) is in the separate [`infra-k8s`](https://github.com/alexandre3gomes/infra-k8s) repository.

## Structure

```
infra/
├── base/                          # Base manifests
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── api/                       # Deployment, Service, ConfigMap, Secret
│   └── ingress/                   # Ingress (nginx, Cloudflare-terminated SSL)
├── overlays/
│   └── production/                # Production overlay (external DBs)
│       ├── kustomization.yaml
│       └── setup.sh              # Interactive initial setup script
└── scripts/
    ├── kube-aliases.sh            # Shell alias: kprod → kubectl on production
    └── setup-prod-kubeconfig.sh   # Configure local kubectl → production VM
```

## Local Development

Local development does **not** use Kubernetes. Services run directly:

| Component | How | Port |
|-----------|-----|------|
| API (NestJS) | `pnpm dev` | `localhost:3001` |
| App (Expo) | `pnpm dev` | `localhost:8081` |
| PostgreSQL | Docker container | `localhost:5432` |
| Redis | Docker container | `localhost:6379` |

```bash
# Start databases
docker compose up -d

# Start all services
pnpm dev
```

## Production

### Topology

| Component | Service | Details |
|-----------|---------|---------|
| Frontend | Cloudflare Pages | Project `fs-suite-app` |
| API | K3s Deployment | OCI VM (`158.179.221.244`), ARM64 |
| Database | Neon | Serverless PostgreSQL, TLS |
| Cache | Upstash | Serverless Redis, TLS |
| DNS/SSL | Cloudflare | Automatic TLS, auto-renew |
| Container Registry | GHCR | `ghcr.io/alexandre3gomes/fs-suite/api` |

### Domain and DNS

Domain `fs-suite.com` is managed via Cloudflare (nameservers migrated from IONOS).

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| `fs-suite.com` | CNAME | `fs-suite-app.pages.dev` | Proxied |
| `api.fs-suite.com` | A | `158.179.221.244` | Proxied |

SSL is handled entirely by Cloudflare (mode: **Full**). No cert-manager or Let's Encrypt needed on the cluster.

### Network Diagram

```
Internet → Cloudflare (SSL/CDN)
                │
        ┌───────┴────────┐
        │                │
  fs-suite.com    api.fs-suite.com
        │                │
  Cloudflare Pages   OCI VM → ingress-nginx
  (static files)         │
                  namespace: fs-suite
                  ┌─────────┐
                  │   API   │
                  │  :3001  │
                  └────┬────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
  Neon (Postgres) Upstash (Redis) Google
  (external TLS) (external TLS)  (OAuth)
```

### Initial Setup

```bash
# 1. Configure local kubectl → production cluster
./infra/scripts/setup-prod-kubeconfig.sh ubuntu@158.179.221.244

# 2. Load shell aliases
source infra/scripts/kube-aliases.sh

# 3. Run interactive setup (creates namespace, secrets, applies manifests)
./infra/overlays/production/setup.sh

# 4. Verify
kprod get pods
```

### Adding Nodes to the Cluster

To add a new worker node to the K3s cluster:

1. **On the control plane node**, get the join token:
   ```bash
   sudo cat /var/lib/rancher/k3s/server/node-token
   ```

2. **On the new node**, install K3s as agent:
   ```bash
   curl -sfL https://get.k3s.io | K3S_URL=https://158.179.221.244:6443 K3S_TOKEN=<token> sh -
   ```

3. **Verify** the node joined:
   ```bash
   kprod get nodes
   ```

4. If the new node is a different architecture, ensure the Docker image supports it (currently builds ARM64 only via `deploy.yml`).

## CI/CD

Branching model: **feature branches → PR → merge to main**.

| Workflow | Trigger | Action |
|----------|---------|--------|
| `ci.yml` | Push to `main` + PRs | Install, lint, typecheck, build, test |
| `deploy.yml` | Push to `main` (API/infra paths) | Build Docker (ARM64) → GHCR, apply K8s manifests, rollout |
| `deploy-app.yml` | Push to `main` (app/UI paths) | Expo web export → Cloudflare Pages |

### GitHub Secrets

| Secret | Scope | Used by |
|--------|-------|---------|
| `KUBECONFIG` | Environment: `production` | `deploy.yml` — kubectl access to K8s cluster |
| `CLOUDFLARE_API_TOKEN` | Repository | `deploy-app.yml` — Cloudflare Pages deploy (needs Pages:Edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Repository | `deploy-app.yml` — Cloudflare account identification |

### Deploy API (K8s)

On each merge to `main` that changes API code:

1. Builds ARM64 Docker image and pushes to GHCR (tagged with git SHA + `latest`)
2. Applies Kustomize manifests with the new image tag
3. Waits for rollout and verifies pod health

### Deploy App (Cloudflare Pages)

On each merge to `main` that changes frontend code:

1. Installs dependencies and builds Expo web (`expo export --platform web`)
2. Deploys static files to Cloudflare Pages via `wrangler`
3. Global CDN distributes automatically

## Secrets

`base/api/secret.yaml` contains placeholders. In production, `setup.sh` creates the secret interactively:

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `REDIS_URL` | Redis connection string (Upstash, `rediss://` for TLS) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair |
| `ENCRYPTION_KEY` | AES-256-GCM key (32-byte hex) |
| `SENTRY_DSN` / `SENTRY_AUTH_TOKEN` | Sentry error tracking (optional) |

**Never commit real secrets.**
