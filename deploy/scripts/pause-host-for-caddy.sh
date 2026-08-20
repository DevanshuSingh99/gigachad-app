#!/usr/bin/env bash
# Free 80/443 on the shared Oracle VM so Gigachad Caddy can bind.
# Stops nginx, root PM2 apps, and non-Gigachad Docker. Does not delete volumes,
# images, nginx site files, or Let's Encrypt certs.
#
#   sudo CONFIRM=yes /var/www/gigachad-app/deploy/scripts/pause-host-for-caddy.sh
#
# Then start Gigachad with Caddy (see compose.caddy.yaml).

set -euo pipefail

CONFIRM="${CONFIRM:-}"
STATE_DIR="${STATE_DIR:-/var/www/gigachad-app/deploy/pause-state}"
KEEP_GIGACHAD="${KEEP_GIGACHAD:-1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo CONFIRM=yes $0" >&2
  exit 1
fi

if [[ "$CONFIRM" != "yes" ]]; then
  cat >&2 <<EOF
This takes the shared VM's public sites offline (api.devjs.in, invoice, RWA,
orders-and-settlements, plus PM2 node apps).

Re-run with CONFIRM=yes if you accept that downtime.

Optional: KEEP_GIGACHAD=0 also stops the gigachad_* containers.
EOF
  exit 2
fi

if [[ -f "$STATE_DIR/paused" ]]; then
  echo "Already paused (found $STATE_DIR/paused). Restore first, or remove that file if this is stale." >&2
  exit 1
fi

mkdir -p "$STATE_DIR"
date -u +'%Y-%m-%dT%H:%M:%SZ' >"$STATE_DIR/started_at"

ss -lptn >"$STATE_DIR/ss-before.txt" || true
docker ps -a --format '{{.Names}} {{.Status}} {{.Ports}}' >"$STATE_DIR/docker-ps-before.txt" || true

# Root PM2 (v6) owns lynx / fitness / invoice. Do not use ubuntu's empty daemon.
if command -v pm2 >/dev/null 2>&1; then
  pm2 save || true
  pm2 jlist >"$STATE_DIR/pm2-jlist.json" || echo '[]' >"$STATE_DIR/pm2-jlist.json"
  pm2 stop all || true
  echo "pm2" >"$STATE_DIR/pm2-stopped"
fi

docker ps --format '{{.Names}}' | sort >"$STATE_DIR/docker-running-before.txt"

: >"$STATE_DIR/docker-stopped.txt"
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  if [[ "$KEEP_GIGACHAD" == "1" && "$name" == gigachad-* ]]; then
    echo "skip $name (KEEP_GIGACHAD=1)"
    continue
  fi
  echo "docker stop $name"
  docker stop "$name"
  echo "$name" >>"$STATE_DIR/docker-stopped.txt"
done <"$STATE_DIR/docker-running-before.txt"

if systemctl is-active --quiet nginx; then
  systemctl stop nginx
  echo "nginx-was-active" >"$STATE_DIR/nginx"
else
  echo "nginx-was-inactive" >"$STATE_DIR/nginx"
fi

touch "$STATE_DIR/paused"
echo "Paused. 80/443 should be free. Next:"
echo "  cd /var/www/gigachad-app"
echo "  COMPOSE_FILE=compose.yaml:compose.prod.yaml:compose.caddy.yaml docker compose up -d --build"
ss -lptn | grep -E ':80 |:443 ' || echo "80/443 are free"
