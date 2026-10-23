#!/usr/bin/env bash
set -euo pipefail
# Ubuntu 24.04 / Debian 12+, x86_64. Run from a reviewed source checkout as root.
PORT="${1:-auto}"
if [[ "$PORT" != auto && ! "$PORT" =~ ^[0-9]+$ ]]; then echo 'Port must be auto or 1024..65535'; exit 1; fi
if [[ "$PORT" != auto ]] && ((PORT < 1024 || PORT > 65535)); then exit 1; fi
[[ "$EUID" == 0 ]] || { echo 'Run with sudo'; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || { echo 'This installer supports x86_64'; exit 1; }
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/gamehub
DATA=/var/lib/gamehub
[[ "$SOURCE" != "$APP" ]] || { echo 'Use a separate source checkout for installation'; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] || { echo 'Ubuntu / Debian required'; exit 1; }
apt-get update
apt-get install -y ca-certificates curl unzip xz-utils tar libatomic1 libstdc++6 libssl3 libicu-dev lib32gcc-s1 lib32stdc++6
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
# A standalone downloaded installer fetches the matching published server bundle.
if [[ ! -f "$SOURCE/package.json" ]]; then
  BASE=https://github.com/DanyBoom/game-hub/releases/download/v0.3.0
  curl -fsSL "$BASE/GameHub-Server-0.3.0.zip" -o "$TMP/GameHub-Server-0.3.0.zip"
  curl -fsSL "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"
  (cd "$TMP" && grep ' GameHub-Server-0.3.0.zip$' SHA256SUMS.txt | sha256sum --check --status)
  mkdir "$TMP/source"
  unzip -q "$TMP/GameHub-Server-0.3.0.zip" -d "$TMP/source"
  SOURCE="$TMP/source"
fi
# Node is verified against the vendor SHA256 manifest before extraction.
NODE_VERSION="$(curl --fail --silent --show-error https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/ {print $2}' | head -n1)"
[[ "$NODE_VERSION" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || exit 1
curl --fail --silent --show-error "https://nodejs.org/dist/latest-v24.x/$NODE_VERSION" -o "$TMP/$NODE_VERSION"
curl --fail --silent --show-error https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$TMP/SHASUMS256.txt"
(cd "$TMP" && grep " $NODE_VERSION\$" SHASUMS256.txt | sha256sum --check --status)
install -d -m 755 /opt/gamehub-node
tar -xJf "$TMP/$NODE_VERSION" --strip-components=1 -C /opt/gamehub-node
export PATH="/opt/gamehub-node/bin:$PATH"
id gamehub >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --create-home --shell /usr/sbin/nologin gamehub
if systemctl is-active --quiet gamehub; then systemctl stop gamehub; fi
install -d -m 755 "$APP"
# Copy only source and lock files. Worlds, credentials and the source checkout's node_modules are excluded.
(cd "$SOURCE" && tar -cf - package.json package-lock.json tsconfig.json vite.config.ts vite.server.config.ts index.html electron shared src server web native scripts) | (cd "$APP" && tar -xf -)
chown -R gamehub:gamehub "$APP"
install -d -o gamehub -g gamehub -m 700 "$DATA"
runuser -u gamehub -- env PATH="$PATH" npm --prefix "$APP" ci --ignore-scripts --no-audit --no-fund
(cd "$APP" && runuser -u gamehub -- env PATH="$PATH" npm run build:server)
runuser -u gamehub -- /opt/gamehub-node/bin/node "$APP/dist-server/server.cjs" --data "$DATA" --port "$PORT" --host 127.0.0.1 --init
ACTUAL_PORT="$(/opt/gamehub-node/bin/node -p "JSON.parse(require('fs').readFileSync('$DATA/panel.json','utf8')).port")"
cat > /etc/systemd/system/gamehub.service <<EOF
[Unit]
Description=GameHub dedicated server panel
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=gamehub
Group=gamehub
WorkingDirectory=$APP
Environment=PATH=/opt/gamehub-node/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$DATA
ExecStart=/opt/gamehub-node/bin/node $APP/dist-server/server.cjs --data $DATA --port $ACTUAL_PORT --host 0.0.0.0
Restart=on-failure
RestartSec=10
KillMode=mixed
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now gamehub
printf '\nGameHub: https://<server-address>:%s\nService: systemctl status gamehub\n' "$ACTUAL_PORT"
echo 'Allow this TCP port in your firewall. Game ports are shown in each instance. No firewall rules were changed.'
