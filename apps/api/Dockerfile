# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy only the packages needed by the API
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/types/ packages/types/
COPY packages/config/ packages/config/
COPY apps/api/ apps/api/

# Generate Prisma client
WORKDIR /app/apps/api
RUN npx prisma generate

# Build the API
WORKDIR /app
RUN pnpm --filter @fs-suite/api build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Security: run as non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy only the packages needed by the API
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy Prisma schema, generated client, and CLI from builder
COPY apps/api/prisma/ apps/api/prisma/
COPY --from=builder /app/node_modules/.prisma/ node_modules/.prisma/
COPY --from=builder /app/node_modules/prisma/ node_modules/prisma/
COPY --from=builder /app/node_modules/@prisma/engines/ node_modules/@prisma/engines/

# Copy built application
COPY --from=builder /app/apps/api/dist/ apps/api/dist/

# Set ownership
RUN chown -R nestjs:nodejs /app

USER nestjs

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

WORKDIR /app/apps/api

# Start the application (migrations handled by K8s init container)
CMD ["node", "dist/main"]
