# Infraestrutura — FS Suite

Manifests Kubernetes para deploy em produção, organizados com [Kustomize](https://kustomize.io/).

> A infraestrutura do cluster (bootstrap, namespaces, quotas, monitoring, TLS) está no repositório separado [`infra-k8s`](https://github.com/alexandre3gomes/infra-k8s).

## Estrutura

```
infra/
├── base/                          # Manifests base (API, Ingress, Namespace)
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── api/                       # Deployment, Service, ConfigMap, Secret
│   └── ingress/                   # Ingress nginx com TLS
├── overlays/
│   └── production/                # Produção: external DBs (Neon + Upstash)
│       ├── kustomization.yaml
│       ├── patch-deployment-external-db.yaml
│       └── setup.sh              # Setup inicial interativo
└── scripts/
    ├── kube-aliases.sh            # Alias kprod para kubectl prod
    └── setup-prod-kubeconfig.sh   # Configurar kubectl local → VM prod
```

## Ambiente local

O dev local **não usa Kubernetes**. Roda diretamente:

| Componente | Como roda | Porta |
|------------|-----------|-------|
| API (NestJS) | `pnpm dev` (nest start --watch) | `localhost:3001` |
| App (Expo) | `pnpm dev` (expo start --web) | `localhost:8081` |
| PostgreSQL | Docker container `fs-suite-postgres` | `localhost:5433` |
| Redis | Docker container `fs-suite-redis` | `localhost:6380` |

## Produção

| Componente | Tipo | Serviço |
|------------|------|---------|
| API (NestJS) | Deployment K8s | `ghcr.io/alexandre3gomes/fs-suite/api` |
| PostgreSQL | Externo | **Neon** (serverless) |
| Redis | Externo | **Upstash** (serverless, TLS) |
| Cluster | K3s single-node | OCI VM (`158.179.221.244`) |

### Setup inicial

```bash
# 1. Configurar kubectl local → produção
./infra/scripts/setup-prod-kubeconfig.sh ubuntu@oci-vm

# 2. Carregar alias
source infra/scripts/kube-aliases.sh

# 3. Setup do ambiente (cria namespace, secrets, aplica manifests)
./infra/overlays/production/setup.sh

# 4. Verificar
kprod get pods
```

### CI/CD

O branching model é **feature branches → PR → merge em main**.

| Workflow | Trigger | O que faz |
|----------|---------|-----------|
| `ci.yml` | Push em `main` + PRs para `main` | Install, lint, typecheck, build, test |
| `deploy.yml` | Push em `main` (paths: `apps/api/`, `infra/`, `packages/`) | Build Docker → GHCR, apply K8s manifests, rollout |
| `deploy-app.yml` | Push em `main` (paths: `apps/app/`, `packages/ui/`, `packages/types/`) | Build Expo web → Cloudflare Pages |

### GitHub Secrets necessários

| Secret | Onde criar | Usado por |
|--------|-----------|-----------|
| `KUBECONFIG` | Environment `production` | `deploy.yml` — acesso kubectl ao cluster K8s |
| `CLOUDFLARE_API_TOKEN` | Repo secrets | `deploy-app.yml` — deploy Cloudflare Pages (precisa permissão Pages:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Repo secrets | `deploy-app.yml` — identificação da conta Cloudflare |

### Deploy API (K8s)

A cada merge em `main` que altere código da API:

1. Builda imagem Docker multi-platform (amd64 + arm64) e pusha para GHCR
2. Aplica os manifests via Kustomize com a imagem taggeada pelo git sha
3. Aguarda rollout e verifica health dos pods

### Deploy App (Cloudflare Pages)

A cada merge em `main` que altere código do frontend:

1. Instala dependências e builda o Expo web (`expo export --platform web`)
2. Deploya os static files para Cloudflare Pages via wrangler
3. CDN global distribui automaticamente

## Secrets

O `base/api/secret.yaml` contém placeholders. Em produção, o `setup.sh` cria o secret interativamente:

| Secret | Descrição |
|--------|-----------|
| `DATABASE_URL` | Connection string PostgreSQL (Neon) |
| `REDIS_URL` | Connection string Redis (Upstash) |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth |
| `VATSIM_CLIENT_ID/SECRET` | VATSIM OAuth (opcional) |
| `JWT_PRIVATE_KEY/PUBLIC_KEY` | RS256 keypair |
| `ENCRYPTION_KEY` | AES-256-GCM (32-byte hex) |
| `SENTRY_DSN/AUTH_TOKEN` | Sentry (opcional) |

**Nunca commitar secrets reais.**

## Diagrama de rede (produção)

```
Internet → OCI Security List → ingress-nginx (:443 TLS)
                                      │
                              namespace: fs-suite
                              ┌─────────┐
                              │   API   │
                              │  :3001  │
                              └────┬────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              Neon (Postgres) Upstash (Redis) VATSIM/Google
              (externo TLS)  (externo TLS)   (OAuth externo)
```
