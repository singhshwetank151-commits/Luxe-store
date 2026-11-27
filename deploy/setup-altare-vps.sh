#!/usr/bin/env bash
set -euo pipefail

# One-time setup script for hosting Luxe Store permanently on an Altare.gg Linux VPS
# with Cloudflare Tunnel + GitHub Actions auto-deploy.
#
# Usage (run on your Altare.gg VPS as root):
#   curl -fsSL https://raw.githubusercontent.com/singhshwetank151-commits/Luxe-store/main/deploy/setup-altare-vps.sh | bash
#
# Optional env vars:
#   APP_DIR=/opt/luxe-store   (default: /opt/luxe-store)
#   APP_PORT=8080             (default: 8080)
#   CF_TUNNEL_TOKEN=...       (optional: Cloudflare Tunnel token to start cloudflared immediately)

APP_DIR="${APP_DIR:-/opt/luxe-store}"
APP_PORT="${APP_PORT:-8080}"
KEY_PATH="${HOME}/.ssh/luxe_github_deploy"

echo "==> [1/5] Installing required packages (curl, ca-certificates, openssh-client, rsync, nodejs)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync openssh-client >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 18 ]; then
  echo "==> Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "==> Node.js version: $(node -v)"

echo "==> [2/5] Preparing ${APP_DIR}..."
mkdir -p "${APP_DIR}/deploy" "${APP_DIR}/dist" "${APP_DIR}/logs"

if [ ! -f "${APP_DIR}/deploy/server.mjs" ]; then
  curl -fsSL "https://raw.githubusercontent.com/singhshwetank151-commits/Luxe-store/main/deploy/server.mjs" \
    -o "${APP_DIR}/deploy/server.mjs"
fi

cat > "${APP_DIR}/start.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export HOST=127.0.0.1
export PORT=${APP_PORT}
export DIST_DIR=${APP_DIR}/dist

# Stop previous instance if running
if [ -f "${APP_DIR}/server.pid" ]; then
  OLD_PID=\$(cat "${APP_DIR}/server.pid" || true)
  if [ -n "\${OLD_PID}" ] && kill -0 "\${OLD_PID}" 2>/dev/null; then
    kill "\${OLD_PID}" || true
    sleep 1
  fi
fi

if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  systemctl restart luxe-store
else
  nohup node "${APP_DIR}/deploy/server.mjs" >> "${APP_DIR}/logs/server.log" 2>&1 &
  echo \$! > "${APP_DIR}/server.pid"
fi
EOF
chmod +x "${APP_DIR}/start.sh"

echo "==> [3/5] Configuring persistent Luxe Store web service (port ${APP_PORT})..."
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  cat > /etc/systemd/system/luxe-store.service <<EOF
[Unit]
Description=Luxe Store Web Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=HOST=127.0.0.1
Environment=PORT=${APP_PORT}
Environment=DIST_DIR=${APP_DIR}/dist
ExecStart=/usr/bin/node ${APP_DIR}/deploy/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now luxe-store
else
  echo "    (Container without systemd detected — starting background daemon via start.sh)"
  "${APP_DIR}/start.sh"
fi

echo "==> [4/5] Installing Cloudflare Tunnel (cloudflared)..."
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb >/dev/null
  rm -f /tmp/cloudflared.deb
fi
echo "==> cloudflared version: $(cloudflared --version)"

if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  echo "==> Starting Cloudflare Tunnel..."
  if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
    cloudflared service uninstall >/dev/null 2>&1 || true
    cloudflared service install "${CF_TUNNEL_TOKEN}"
  else
    pkill -f "cloudflared tunnel run" >/dev/null 2>&1 || true
    nohup cloudflared tunnel --no-autoupdate run --token "${CF_TUNNEL_TOKEN}" \
      >> "${APP_DIR}/logs/cloudflared.log" 2>&1 &
    echo $! > "${APP_DIR}/cloudflared.pid"
  fi
fi

echo "==> [5/5] Generating dedicated SSH deploy key for GitHub Actions..."
mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"
touch "${HOME}/.ssh/authorized_keys"
chmod 600 "${HOME}/.ssh/authorized_keys"

if [ ! -f "${KEY_PATH}" ]; then
  ssh-keygen -t ed25519 -N "" -C "github-actions-luxe-store" -f "${KEY_PATH}" >/dev/null
fi

PUB_KEY="$(cat "${KEY_PATH}.pub")"
if ! grep -Fq "${PUB_KEY}" "${HOME}/.ssh/authorized_keys"; then
  echo "${PUB_KEY}" >> "${HOME}/.ssh/authorized_keys"
fi

echo ""
echo "=================================================================="
echo "SETUP COMPLETE!"
echo "=================================================================="
echo "1. Point your Cloudflare Tunnel Public Hostname to:"
echo "   http://127.0.0.1:${APP_PORT}"
echo ""
echo "2. In GitHub -> Settings -> Secrets and variables -> Actions -> Secrets,"
echo "   add these Repository Secrets:"
echo "     VPS_HOST     = <your Altare.gg SSH host/IP>"
echo "     VPS_PORT     = <your Altare.gg SSH port, e.g. 22>"
echo "     VPS_USER     = $(whoami)"
echo "     VPS_SSH_KEY  = (copy the ENTIRE private key block below)"
echo ""
echo "---------- BEGIN VPS_SSH_KEY ----------"
cat "${KEY_PATH}"
echo "----------- END VPS_SSH_KEY -----------"
echo ""
echo "3. Once those secrets are saved, every push to main will"
echo "   automatically build & deploy Luxe Store to ${APP_DIR}!"
echo "=================================================================="
