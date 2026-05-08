# Infraestrutura — FS Suite

Manifests Kubernetes da aplicação FS Suite, organizados com [Kustomize](https://kustomize.io/) (base + overlays por ambiente).

> A infraestrutura do cluster (bootstrap, namespaces, quotas, monitoring, TLS) está no repositório separado [`infra-k8s`](https://github.com/alexandre3gomes/infra-k8s).

## Estrutura

```
infra/
├── base/                          # Manifests compartilhados (valores de produção)
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── api/                       # Deployment, Service, ConfigMap, Secret
│   ├── postgres/                  # StatefulSet, Service
│   ├── redis/                     # Deployment, PVC, Service
│   └── ingress/                   # Ingress nginx com TLS
└── overlays/
    ├── local/                     # Dev local: localhost, HTTP, imagem local
    ├── staging/                   # Staging: domínio staging, letsencrypt-staging
    └── production/                # Produção: usa base as-is
```

## Stack

| Componente | Imagem | Porta | Tipo K8s | Storage |
|------------|--------|-------|----------|---------|
| API (NestJS) | `ghcr.io/fs-suite/api:latest` | 3001 | Deployment | — |
| PostgreSQL | `postgres:16-alpine` | 5432 | StatefulSet | PVC 10Gi |
| Redis | `redis:7-alpine` | 6379 | Deployment | PVC 2Gi |

### Recursos alocados

| Componente | CPU request/limit | Memoria request/limit |
|------------|-------------------|-----------------------|
| API | 100m / 500m | 256Mi / 512Mi |
| PostgreSQL | 100m / 500m | 256Mi / 512Mi |
| Redis | 50m / 200m | 128Mi / 256Mi |

## Deploy por ambiente

### Pré-requisito

O cluster deve estar provisionado via [`infra-k8s`](https://github.com/alexandre3gomes/infra-k8s). Para dev local:

```bash
cd ../infra-k8s && ./local/setup.sh
```

### Local

```bash
# 1. Preencher secrets
vim infra/base/api/secret.yaml

# 2. Aplicar
kubectl apply -k infra/overlays/local/

# 3. Verificar
kubectl get pods -n fs-suite
```

> A imagem `fs-suite/api:local` deve estar pré-construída: `docker build -t fs-suite/api:local .`

### Staging

```bash
kubectl apply -k infra/overlays/staging/
```

### Produção

```bash
kubectl apply -k infra/overlays/production/
```

O deploy automatizado via CI/CD (`.github/workflows/deploy.yml`) aplica o overlay de produção com a image tag do git sha.

## Overlays — o que cada um patcha

| Config | Base (prod) | Local | Staging |
|--------|-------------|-------|---------|
| NODE_ENV | `production` | `development` | `staging` |
| Namespace | `fs-suite` | `fs-suite` | `staging` |
| Host | `api.fssuite.app` | `localhost` | `api-staging.fssuite.app` |
| OAuth callback | `https://api.fssuite.app/...` | `http://localhost:8090/...` | `https://api-staging.fssuite.app/...` |
| WEB_ORIGIN | `https://fssuite.app` | `http://localhost:3000` | `https://staging.fssuite.app` |
| TLS | letsencrypt-prod | Desabilitado | letsencrypt-staging |
| Imagem | `ghcr.io/fs-suite/api:latest` | `fs-suite/api:local` (Never) | Base (CI/CD override) |

## Secrets

O `base/api/secret.yaml` contém placeholders para:

| Secret | Descrição |
|--------|-----------|
| `POSTGRES_PASSWORD` | Senha do PostgreSQL |
| `REDIS_PASSWORD` | Senha do Redis |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google OAuth |
| `JWT_PRIVATE_KEY` | Chave privada para JWTs (RS256) |
| `JWT_PUBLIC_KEY` | Chave pública para JWTs |
| `ENCRYPTION_KEY` | AES-256-GCM para dados sensíveis |
| `SENTRY_DSN` | DSN do Sentry |
| `SENTRY_AUTH_TOKEN` | Token para release management |

**Nunca commitar secrets reais.** Para produção, usar Sealed Secrets, External Secrets, ou OCI Vault.

## Observabilidade

### Sentry

| Variável | Origem | Descrição |
|----------|--------|-----------|
| `SENTRY_DSN` | Secret | DSN do projeto Sentry |
| `SENTRY_RELEASE` | ConfigMap | Placeholder `__DEPLOY_RELEASE__`, substituído pelo git sha no CI/CD |
| `SENTRY_AUTH_TOKEN` | Secret | Token para sourcemap upload |

Sentry desabilitado em dev (`NODE_ENV !== 'production'`). Release tracking automático em produção.

### Retenção de dados

Job automático in-process via `@nestjs/schedule`:

| Dado | Regra | Horário |
|------|-------|---------|
| Sessions expiradas | `expiresAt < now()` | 02:00 UTC diário |
| ActivityLog > 12 meses | `createdAt < now() - 12m` (LGPD) | 02:00 UTC diário |

Idempotente, timezone explícito UTC, monitorado via Sentry + stdout.

## Init container

O Deployment da API inclui um init container que executa `npx prisma migrate deploy` antes de iniciar. No overlay local, usa imagem `fs-suite/api:local`.

## Diagrama de rede (produção)

```
Internet → OCI Security List → ingress-nginx (:443 TLS)
                                      │
                              namespace: fs-suite
                    ┌─────────┬───────────┬───────────┐
                    │   API   │ PostgreSQL│   Redis   │
                    │  :3001  │   :5432   │   :6379   │
                    └─────────┴───────────┴───────────┘
```
