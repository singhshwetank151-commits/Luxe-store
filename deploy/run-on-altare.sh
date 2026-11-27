#!/usr/bin/env bash
set -euo pipefail

# Zero-SSH auto-deploy installer for Altare.gg Linux Sandbox containers.
# Uses outbound HTTPS only (no inbound SSH port required!) and auto-syncs
# every push from GitHub main every 30 seconds.
#
# Usage in Altare.gg Console (root@sandbox:#):
#   apt-get update -qq && apt-get install -y -qq curl && CF_TUNNEL_TOKEN="YOUR_TOKEN" bash -c "$(curl -fsSL https://raw.githubusercontent.com/singhshwetank151-commits/Luxe-store/main/deploy/run-on-altare.sh)"

APP_DIR="${APP_DIR:-/opt/luxe-store}"
APP_PORT="${APP_PORT:-8080}"
REPO_URL="https://github.com/singhshwetank151-commits/Luxe-store.git"
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://youixtxcfluaskmylqmp.supabase.co}"
VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-sb_publishable_g1-QdPxam4uyapbAeM5Bvg_Aujure-z}"

export DEBIAN_FRONTEND=noninteractive

echo "==> [1/5] Installing git, curl, Node.js 22, and cloudflared..."
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb >/dev/null
  rm -f /tmp/cloudflared.deb
fi

echo "==> [2/5] Cloning & building Luxe Store in ${APP_DIR}..."
mkdir -p "${APP_DIR}/logs"
if [ -d "${APP_DIR}/repo/.git" ]; then
  git -C "${APP_DIR}/repo" fetch origin main --quiet
  git -C "${APP_DIR}/repo" reset --hard origin/main --quiet
else
  rm -rf "${APP_DIR}/repo"
  git clone --depth 1 --branch main "${REPO_URL}" "${APP_DIR}/repo" --quiet
fi

cat > "${APP_DIR}/.env" <<EOF
VITE_BASE_PATH=/
VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
EOF
chmod 600 "${APP_DIR}/.env"

cat > "${APP_DIR}/build-and-restart.sh" <<'BUILDEOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
source "${APP_DIR}/.env"
set +a

cd "${APP_DIR}/repo"
npm ci --no-audit --no-fund >/dev/null
npm run build >/dev/null

rm -rf "${APP_DIR}/dist.new" "${APP_DIR}/dist.old"
cp -a "${APP_DIR}/repo/dist" "${APP_DIR}/dist.new"
if [ -d "${APP_DIR}/dist" ]; then
  mv "${APP_DIR}/dist" "${APP_DIR}/dist.old"
fi
mv "${APP_DIR}/dist.new" "${APP_DIR}/dist"
rm -rf "${APP_DIR}/dist.old"

mkdir -p "${APP_DIR}/deploy"
cp "${APP_DIR}/repo/deploy/server.mjs" "${APP_DIR}/deploy/server.mjs"

if [ -f "${APP_DIR}/server.pid" ]; then
  OLD_PID="$(cat "${APP_DIR}/server.pid" || true)"
  if [ -n "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null; then
    kill "${OLD_PID}" || true
    sleep 1
  fi
fi

HOST=127.0.0.1 PORT="${APP_PORT:-8080}" DIST_DIR="${APP_DIR}/dist" \
  nohup node "${APP_DIR}/deploy/server.mjs" </dev/null >> "${APP_DIR}/logs/server.log" 2>&1 &
echo $! > "${APP_DIR}/server.pid"
BUILDEOF
chmod +x "${APP_DIR}/build-and-restart.sh"

echo "==> [3/5] Running initial build & starting Luxe Store on http://127.0.0.1:${APP_PORT}..."
APP_PORT="${APP_PORT}" "${APP_DIR}/build-and-restart.sh"

echo "==> [4/5] Starting GitHub auto-sync daemon (polls main every 30s)..."
cat > "${APP_DIR}/auto-sync.sh" <<'SYNCEOF'
#!/usr/bin/env bash
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
while true; do
  sleep 30
  if git -C "${APP_DIR}/repo" fetch origin main --quiet 2>/dev/null; then
    LOCAL="$(git -C "${APP_DIR}/repo" rev-parse HEAD 2>/dev/null || true)"
    REMOTE="$(git -C "${APP_DIR}/repo" rev-parse origin/main 2>/dev/null || true)"
    if [ -n "${REMOTE}" ] && [ "${LOCAL}" != "${REMOTE}" ]; then
      echo "[$(date -u +%FT%TZ)] New commit ${REMOTE:0:7} detected — rebuilding..." >> "${APP_DIR}/logs/sync.log"
      git -C "${APP_DIR}/repo" reset --hard origin/main --quiet >> "${APP_DIR}/logs/sync.log" 2>&1
      "${APP_DIR}/build-and-restart.sh" >> "${APP_DIR}/logs/sync.log" 2>&1 || true
      echo "[$(date -u +%FT%TZ)] Deployed ${REMOTE:0:7}!" >> "${APP_DIR}/logs/sync.log"
    fi
  fi
done
SYNCEOF
chmod +x "${APP_DIR}/auto-sync.sh"

if [ -f "${APP_DIR}/sync.pid" ]; then
  OLD_SYNC="$(cat "${APP_DIR}/sync.pid" || true)"
  if [ -n "${OLD_SYNC}" ] && kill -0 "${OLD_SYNC}" 2>/dev/null; then
    kill "${OLD_SYNC}" || true
  fi
fi
nohup "${APP_DIR}/auto-sync.sh" </dev/null >> "${APP_DIR}/logs/sync.log" 2>&1 &
echo $! > "${APP_DIR}/sync.pid"

echo "==> [5/5] Connecting Cloudflare Tunnel..."
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  CLEAN_TOKEN="$(printf '%s' "${CF_TUNNEL_TOKEN}" | tr -d '\r\n' | awk '{print $NF}')"
  umask 077
  printf '%s' "${CLEAN_TOKEN}" > "${APP_DIR}/.cf_token"
  pkill -f "cloudflared tunnel" >/dev/null 2>&1 || true
  TUNNEL_TOKEN="$(cat "${APP_DIR}/.cf_token")" \
    nohup cloudflared tunnel --no-autoupdate run </dev/null >> "${APP_DIR}/logs/cloudflared.log" 2>&1 &
  echo $! > "${APP_DIR}/cloudflared.pid"
  echo "    Cloudflare Tunnel started!"
else
  echo "    No CF_TUNNEL_TOKEN provided — start it later with:"
  echo "    nohup cloudflared tunnel --no-autoupdate run --token YOUR_TOKEN </dev/null >> ${APP_DIR}/logs/cloudflared.log 2>&1 &"
fi

sleep 1
echo ""
echo "=================================================================="
echo "ALL SET! Local health check: $(curl -s http://127.0.0.1:${APP_PORT}/healthz || echo 'starting...')"
echo "  - Web server:  http://127.0.0.1:${APP_PORT}"
echo "  - Auto-sync:   checks GitHub main every 30 seconds"
echo "  - Cloudflare:  switch back to your Cloudflare tab — Continue should unlock now!"
echo "=================================================================="
