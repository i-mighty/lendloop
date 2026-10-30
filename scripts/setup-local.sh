#!/usr/bin/env bash
# One-time local setup. Generates the integration secrets (never printed), writes
# them to .env.n8n for Docker, and sets the matching Convex environment variables.
# Needs `npx convex dev` running in another terminal.
#
#   ./scripts/setup-local.sh you@example.com     # your email becomes the first admin
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN_EMAILS="${1:-${ADMIN_EMAILS:-}}"

if [ ! -f .env.local ]; then
  echo "Missing .env.local. Run 'npx convex dev' and set the Clerk keys first (see README)." >&2
  exit 1
fi

read_env() { grep -E "^$1=" "$2" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' || true; }

if [ ! -f .env.n8n ]; then
  umask 077
  {
    echo "CONVEX_TO_N8N_SECRET=$(openssl rand -hex 32)"
    echo "N8N_TO_CONVEX_SECRET=$(openssl rand -hex 32)"
    echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 24)"
  } > .env.n8n
  echo "Generated .env.n8n (gitignored)."
fi

site_url="$(read_env NEXT_PUBLIC_CONVEX_SITE_URL .env.local)"
# n8n runs in Docker, so it reaches the Convex backend on the host through host.docker.internal.
docker_site_url="${site_url/127.0.0.1/host.docker.internal}"
docker_site_url="${docker_site_url/localhost/host.docker.internal}"
if grep -q "^CONVEX_SITE_URL=" .env.n8n; then
  sed -i.bak "s#^CONVEX_SITE_URL=.*#CONVEX_SITE_URL=${docker_site_url}#" .env.n8n && rm -f .env.n8n.bak
else
  echo "CONVEX_SITE_URL=${docker_site_url}" >> .env.n8n
fi

publishable_key="$(read_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY .env.local)"
if [ -z "$publishable_key" ]; then
  echo "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not in .env.local yet. Start 'npm run dev' once, or add your Clerk keys." >&2
  exit 1
fi
# The publishable key is base64("<frontend-api-host>$") after the pk_test_/pk_live_ prefix.
clerk_host="$(echo "${publishable_key#pk_*_}" | base64 -d 2>/dev/null | tr -d '$')"

# Output is silenced so secret values never reach the terminal; failures still stop the script.
set_convex() {
  if npx convex env set "$1" "$2" > /dev/null 2>&1; then
    echo "Set Convex env $1"
  else
    echo "Could not set $1. Is 'npx convex dev' running?" >&2
    exit 1
  fi
}
set_convex CLERK_JWT_ISSUER_DOMAIN "https://${clerk_host}"
set_convex CONVEX_TO_N8N_SECRET "$(read_env CONVEX_TO_N8N_SECRET .env.n8n)"
set_convex N8N_TO_CONVEX_SECRET "$(read_env N8N_TO_CONVEX_SECRET .env.n8n)"
set_convex N8N_LOAN_EVENT_WEBHOOK_URL "http://localhost:5678/webhook/lendloop-loan-event"
set_convex APP_URL "http://localhost:3000"
if [ -n "$ADMIN_EMAILS" ]; then set_convex ADMIN_EMAILS "$ADMIN_EMAILS"; fi

echo "Done. Next: docker compose up -d   (n8n on :5678, Mailpit inbox on :8025)"
