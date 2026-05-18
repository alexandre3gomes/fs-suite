#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — EC2 Setup
#
# Provisions a fresh Amazon Linux 2023 instance with everything
# needed to run the API: Docker, nginx reverse proxy, .env secrets.
#
# Prerequisites:
#   - Amazon Linux 2023 EC2 instance (t3.small recommended)
#   - SSH access as ec2-user
#   - All secret values ready (DB URL, Redis, OAuth, JWT keys, etc.)
#   - GitHub PAT with read:packages scope (for GHCR image pull)
#
# Usage:
#   ssh ec2-user@<elastic-ip>
#   curl -sO https://raw.githubusercontent.com/alexandre3gomes/fs-suite/main/infra/ec2/setup.sh
#   chmod +x setup.sh && ./setup.sh
# ──────────────────────────────────────────────────────────────

APP_DIR="/opt/fs-suite"
IMAGE="ghcr.io/alexandre3gomes/fs-suite-api:latest"

echo "╔══════════════════════════════════════════════╗"
echo "║     FS Suite — EC2 Setup                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Install Docker ─────────────────────────────────────────

echo "Installing Docker..."
sudo dnf update -y -q
sudo dnf install -y -q docker curl

sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user

echo "Installing Docker Compose plugin..."
COMPOSE_VERSION="v2.29.1"
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -sL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

echo "Docker $(docker --version | cut -d' ' -f3) installed."
echo "Docker Compose $(docker compose version --short) installed."
echo ""

# ── App directory ──────────────────────────────────────────

sudo mkdir -p "$APP_DIR"
sudo chown ec2-user:ec2-user "$APP_DIR"

# ── Authenticate to GHCR ──────────────────────────────────

echo "── GitHub Container Registry ──"
echo "Create a PAT at https://github.com/settings/tokens"
echo "Required scope: read:packages"
echo ""
read -rp "GitHub username: " GH_USER
read -rsp "GitHub PAT: " GH_PAT
echo ""

echo "$GH_PAT" | docker login ghcr.io -u "$GH_USER" --password-stdin
echo ""

# ── Write nginx config ────────────────────────────────────

cat > "$APP_DIR/nginx.conf" << 'NGINX'
server {
    listen 80;
    server_name api.fs-suite.com;

    location / {
        proxy_pass http://api:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 300s;
    }
}
NGINX

echo "Nginx config written."

# ── Write docker-compose.yml ──────────────────────────────

cat > "$APP_DIR/docker-compose.yml" << 'COMPOSE'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

  api:
    image: ghcr.io/alexandre3gomes/fs-suite-api:latest
    env_file: .env
    expose:
      - "3001"
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3001/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
COMPOSE

echo "Docker Compose config written."
echo ""

# ── Collect secrets ────────────────────────────────────────

read_secret() {
  local prompt="$1"
  local default="${2:-}"
  if [[ -n "$default" ]]; then
    prompt="$prompt [$default]"
  fi
  read -rp "$prompt: " value
  [[ -z "$value" && -n "$default" ]] && value="$default"
  echo "$value"
}

read_multiline() {
  local prompt="$1"
  echo "$prompt (paste content, then press Ctrl+D on a new line):"
  local content
  content=$(cat)
  echo "$content"
}

echo "── Secrets ──"
echo "Enter values for each secret."
echo ""

echo "── External databases ──"
DB_URL=$(read_secret "DATABASE_URL (Neon connection string)")
REDIS=$(read_secret "REDIS_URL (Upstash connection string)")
echo ""

echo "── Google OAuth ──"
G_CLIENT_ID=$(read_secret "GOOGLE_CLIENT_ID")
G_CLIENT_SECRET=$(read_secret "GOOGLE_CLIENT_SECRET")
echo ""

echo "── JWT RS256 keypair ──"
JWT_PRIV=$(read_multiline "JWT_PRIVATE_KEY")
JWT_PUB=$(read_multiline "JWT_PUBLIC_KEY")
echo ""

echo "── Encryption ──"
ENC_KEY=$(read_secret "ENCRYPTION_KEY (32-byte hex)")
echo ""

echo "── Sentry (press Enter to skip) ──"
SENTRY=$(read_secret "SENTRY_DSN" "")
echo ""

echo "── AI providers (press Enter to skip) ──"
GEMINI=$(read_secret "GEMINI_API_KEY" "")
GROQ=$(read_secret "GROQ_API_KEY" "")
echo ""

echo "── Cloudflare R2 (press Enter to skip) ──"
R2_ACCT=$(read_secret "R2_ACCOUNT_ID" "")
R2_KEY=$(read_secret "R2_ACCESS_KEY_ID" "")
R2_SECRET=$(read_secret "R2_SECRET_ACCESS_KEY" "")
echo ""

# ── Write .env ─────────────────────────────────────────────

cat > "$APP_DIR/.env" << ENV
NODE_ENV=production
PORT=3001
GOOGLE_CALLBACK_URL=https://api.fs-suite.com/v1/auth/google/callback
WEB_ORIGIN=https://fs-suite.com
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
R2_BUCKET_NAME=fs-suite-charts
SENTRY_RELEASE=initial
DATABASE_URL=${DB_URL}
REDIS_URL=${REDIS}
GOOGLE_CLIENT_ID=${G_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${G_CLIENT_SECRET}
JWT_PRIVATE_KEY=${JWT_PRIV}
JWT_PUBLIC_KEY=${JWT_PUB}
ENCRYPTION_KEY=${ENC_KEY}
SENTRY_DSN=${SENTRY}
GEMINI_API_KEY=${GEMINI}
GROQ_API_KEY=${GROQ}
R2_ACCOUNT_ID=${R2_ACCT}
R2_ACCESS_KEY_ID=${R2_KEY}
R2_SECRET_ACCESS_KEY=${R2_SECRET}
ENV

chmod 600 "$APP_DIR/.env"
echo ".env written (chmod 600)."
echo ""

# ── Pull and start ─────────────────────────────────────────

echo "Pulling image and starting services..."
cd "$APP_DIR"
docker compose pull
docker compose up -d

echo ""
echo "Waiting for health check..."
sleep 10

if curl -sf http://localhost/v1/health > /dev/null 2>&1; then
  echo "Health check passed!"
  curl -s http://localhost/v1/health
  echo ""
else
  echo "Warning: health check failed. Check logs with: docker compose logs -f api"
fi

# ── Summary ────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     Setup complete!                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Allocate an Elastic IP and associate with this instance"
echo "  2. Configure Security Group:"
echo "     - Port 80 (HTTP): 0.0.0.0/0"
echo "     - Port 22 (SSH): your IP only"
echo "  3. Cloudflare DNS:"
echo "     - A record: api.fs-suite.com → <Elastic IP> (Proxied)"
echo "     - Delete the Cloudflare Worker (winter-pine-bca5)"
echo "  4. GitHub Secrets (Settings > Secrets > Actions):"
echo "     - EC2_HOST = <Elastic IP>"
echo "     - EC2_SSH_KEY = <private SSH key>"
echo "     - EC2_USER = ec2-user"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f api     # API logs"
echo "  docker compose restart api     # Restart API"
echo "  docker compose pull && docker compose up -d  # Manual deploy"
echo ""
