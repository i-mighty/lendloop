#!/bin/sh
# Container start-up for n8n: import the SMTP credential (built from environment
# variables, so no credential data lives in the repo), import and publish the
# LendLoop workflows, then start n8n.
set -eu

umask 077
credentials_file="$(mktemp)"
cat > "$credentials_file" <<EOF
[{
  "id": "lendloopSmtp0001",
  "name": "LendLoop SMTP",
  "type": "smtp",
  "data": {
    "host": "${SMTP_HOST:-mailpit}",
    "port": ${SMTP_PORT:-1025},
    "user": "${SMTP_USER:-}",
    "password": "${SMTP_PASSWORD:-}",
    "secure": ${SMTP_SECURE:-false},
    "disableStartTls": ${SMTP_DISABLE_STARTTLS:-true}
  }
}]
EOF
n8n import:credentials --input="$credentials_file"
rm -f "$credentials_file"

n8n import:workflow --separate --input=/opt/lendloop/workflows

# n8n 2.x only runs published workflows, the error handler included.
n8n publish:workflow --id=lendloopEvents01
n8n publish:workflow --id=lendloopRemind01
n8n publish:workflow --id=lendloopErrors01

exec n8n start
