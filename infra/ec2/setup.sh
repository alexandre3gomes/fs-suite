#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# FS Suite — EC2 Setup
#
# Provisions a fresh Amazon Linux 2023 instance with everything
# needed to run the API: Docker, nginx reverse proxy, TLS, secrets.
#
# Prerequisites:
#   - Amazon Linux 2023 EC2 instance (t3.small recommended)
#   - SSH access as ec2-user
#   - A .env file with all secrets (see .env.example)
#   - Cloudflare Origin Certificate files (origin.pem + origin-key.pem)
#   - GitHub PAT with read:packages scope (for initial GHCR pull)
#
# Usage:
#   # 1. Copy files to EC2
#   scp .env origin.pem origin-key.pem fs-suite:~/
#
#   # 2. SSH in and run
#   ssh fs-suite
#   curl -sO https://raw.githubusercontent.com/alexandre3gomes/fs-suite/main/infra/ec2/setup.sh
#   chmod +x setup.sh && ./setup.sh
# ──────────────────────────────────────────────────────────────

APP_DIR="/opt/fs-suite"

echo "╔══════════════════════════════════════════════╗"
echo "║     FS Suite — EC2 Setup                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Validate input files ──────────────────────────────────

ENV_FILE="${1:-$HOME/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Usage: ./setup.sh [path/to/.env]"
  echo ""
  echo "The .env must contain all required variables. See infra/ec2/.env.example"
  exit 1
fi

ORIGIN_CERT="${HOME}/origin.pem"
ORIGIN_KEY="${HOME}/origin-key.pem"

if [[ ! -f "$ORIGIN_CERT" || ! -f "$ORIGIN_KEY" ]]; then
  echo "Error: TLS certificate files not found"
  echo "Expected: ~/origin.pem and ~/origin-key.pem"
  echo ""
  echo "Generate at: Cloudflare > SSL/TLS > Origin Server > Create Certificate"
  echo "  - Hostnames: api.fs-suite.com"
  echo "  - Validity: 15 years"
  echo "  - Key format: PEM"
  exit 1
fi

echo "Input files:"
echo "  .env:       $ENV_FILE"
echo "  TLS cert:   $ORIGIN_CERT"
echo "  TLS key:    $ORIGIN_KEY"
echo ""

# ── Install Docker ─────────────────────────────────────────

echo "Installing Docker..."
sudo dnf update -y -q
sudo dnf install -y -q docker

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
echo "This PAT is only for the initial image pull."
echo "Automated deploys use short-lived GITHUB_TOKEN from Actions."
echo ""
echo "Create a PAT at: https://github.com/settings/tokens"
echo "Required scope: read:packages"
echo ""
read -rp "GitHub username: " GH_USER
read -rsp "GitHub PAT: " GH_PAT
echo ""

echo "$GH_PAT" | docker login ghcr.io -u "$GH_USER" --password-stdin
echo ""

# ── TLS certificates ─────────────────────────────────────

CERTS_DIR="$APP_DIR/certs"
mkdir -p "$CERTS_DIR"
cp "$ORIGIN_CERT" "$CERTS_DIR/origin.pem"
cp "$ORIGIN_KEY" "$CERTS_DIR/origin-key.pem"
chmod 644 "$CERTS_DIR/origin.pem"
chmod 600 "$CERTS_DIR/origin-key.pem"
echo "TLS certificates installed."

# ── Write nginx config ────────────────────────────────────

cat > "$APP_DIR/nginx.conf" << 'NGINX'
server {
    listen 80;
    server_name api.fs-suite.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.fs-suite.com;

    ssl_certificate     /etc/nginx/certs/origin.pem;
    ssl_certificate_key /etc/nginx/certs/origin-key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

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
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
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
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
COMPOSE

echo "Docker Compose config written."
echo ""

# ── Process .env ──────────────────────────────────────────
# Reads the provided .env and adds non-secret defaults. Keeps every
# secret value (including JWT keys) as-is — the canonical .env is the
# source of truth.

process_env() {
  local src="$1"
  local dst="$2"

  cat > "$dst" << 'DEFAULTS'
NODE_ENV=production
PORT=3001
GOOGLE_CALLBACK_URL=https://api.fs-suite.com/v1/auth/google/callback
WEB_ORIGIN=https://fs-suite.com
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
R2_BUCKET_NAME=fs-suite-charts
SENTRY_RELEASE=initial
DEFAULTS

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue

    case "$line" in
      NODE_ENV=*|PORT=*|GOOGLE_CALLBACK_URL=*|WEB_ORIGIN=*) continue ;;
      JWT_ACCESS_EXPIRES_IN=*|JWT_REFRESH_EXPIRES_IN=*) continue ;;
      R2_BUCKET_NAME=*|SENTRY_RELEASE=*) continue ;;
    esac

    echo "$line" >> "$dst"
  done < "$src"
}

process_env "$ENV_FILE" "$APP_DIR/.env"

# ── JWT RS256 keypair ─────────────────────────────────────
# Source of truth: the canonical .env. If JWT_PRIVATE_KEY +
# JWT_PUBLIC_KEY are both already present (preserved from a previous
# reprovision or provided by the operator), keep them — sessions
# survive the reprovisioning. Otherwise generate fresh keys and tell
# the operator to capture them back into the canonical .env so the
# next EC2 reprovision is session-preserving.

if grep -q '^JWT_PRIVATE_KEY=' "$APP_DIR/.env" && \
   grep -q '^JWT_PUBLIC_KEY=' "$APP_DIR/.env"; then
  echo "JWT keypair found in .env — preserving (sessions survive reprovisioning)."
  GENERATED_JWT=false
else
  echo "JWT keypair absent from .env — generating fresh RS256 2048-bit pair..."
  JWT_TMP=$(mktemp -d)
  openssl genrsa -out "$JWT_TMP/private.pem" 2048 2>/dev/null
  openssl rsa -in "$JWT_TMP/private.pem" -pubout -out "$JWT_TMP/public.pem" 2>/dev/null

  JWT_PRIV=$(awk '{printf "%s\\n", $0}' "$JWT_TMP/private.pem")
  JWT_PUB=$(awk '{printf "%s\\n", $0}' "$JWT_TMP/public.pem")

  echo "JWT_PRIVATE_KEY=\"${JWT_PRIV}\"" >> "$APP_DIR/.env"
  echo "JWT_PUBLIC_KEY=\"${JWT_PUB}\"" >> "$APP_DIR/.env"

  rm -rf "$JWT_TMP"
  echo "JWT keypair generated and written to .env."
  GENERATED_JWT=true
fi

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
for i in 1 2 3 4 5 6; do
  if curl -sf http://localhost/v1/health > /dev/null 2>&1; then
    echo "Health check passed!"
    curl -s http://localhost/v1/health
    echo ""
    break
  fi
  echo "Attempt $i — waiting 5s..."
  sleep 5
done

# ── Cleanup ───────────────────────────────────────────────

rm -f "$HOME/origin.pem" "$HOME/origin-key.pem"
echo "Cleaned up certificate files from home directory."

# ── Summary ────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     Setup complete!                          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

if [[ "${GENERATED_JWT:-false}" == "true" ]]; then
  echo "⚠  FRESH JWT KEYS GENERATED — capture them into the canonical .env"
  echo "   (Bitwarden) so future EC2 reprovisions preserve sessions:"
  echo ""
  echo "     ssh fs-suite \"sudo grep -E '^JWT_(PRIVATE|PUBLIC)_KEY=' /opt/fs-suite/.env\""
  echo ""
  echo "   Paste both lines into the canonical .env."
  echo ""
fi

echo "Checklist:"
echo ""
echo "  1. Elastic IP allocated and associated"
echo "  2. Security Group:"
echo "     - Port 443 (HTTPS): 0.0.0.0/0"
echo "     - Port 80 (HTTP): 0.0.0.0/0 (redirects to HTTPS)"
echo "     - Port 22 (SSH): 0.0.0.0/0 (key-only auth)"
echo "  3. Cloudflare DNS:"
echo "     - A record: api.fs-suite.com → <Elastic IP> (Proxied)"
echo "     - SSL/TLS mode: Full (Strict)"
echo "  4. GitHub Secrets:"
echo "     - EC2_HOST = <Elastic IP>"
echo "     - EC2_SSH_KEY = <private SSH key>"
echo "     - EC2_USER = ec2-user"
echo "     - ADMIN_METRICS_TOKEN = (sync from your .env, see infra/README.md):"
echo "       gh secret set ADMIN_METRICS_TOKEN \\"
echo "         --body \"\$(grep '^ADMIN_METRICS_TOKEN=' /path/to/.env | cut -d= -f2-)\""
echo ""
echo "Commands:"
echo "  docker compose logs -f api     # API logs"
echo "  docker compose restart api     # Restart API"
echo "  docker compose pull && docker compose up -d  # Manual deploy"
echo ""
