#!/usr/bin/env bash
# Reverse pause-host-for-caddy.sh: take Caddy off 80/443, start nginx, then
# the Docker containers and PM2 apps that were stopped. Does not docker rm,
# compose down -v, or enable nginx (it was already disabled on this VM).
#
#   sudo CONFIRM=yes /var/www/gigachad-app/deploy/scripts/restore-host-from-caddy.sh

set -euo pipefail

CONFIRM="${CONFIRM:-}"
STATE_DIR="${STATE_DIR:-/var/www/gigachad-app/deploy/pause-state}"
GIGACHAD_DIR="${GIGACHAD_DIR:-/var/www/gigachad-app}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo CONFIRM=yes $0" >&2
  exit 1
fi

if [[ "$CONFIRM" != "yes" ]]; then
  echo "Re-run with CONFIRM=yes to restore nginx, PM2, and saved Docker containers." >&2
  exit 2
fi

if [[ ! -f "$STATE_DIR/paused" ]]; then
  echo "No pause state at $STATE_DIR/paused. Refusing to guess." >&2
  exit 1
fi

# Caddy must release 80/443 before nginx can bind. Prefer compose stop; fall
# back to any container publishing those ports.
if [[ -f "$GIGACHAD_DIR/compose.caddy.yaml" ]]; then
  docker compose \
    --project-directory "$GIGACHAD_DIR" \
    -f "$GIGACHAD_DIR/compose.yaml" \
    -f "$GIGACHAD_DIR/compose.prod.yaml" \
    -f "$GIGACHAD_DIR/compose.caddy.yaml" \
    stop caddy || true
fi

docker ps --format '{{.Names}}' | while IFS= read -r name; do
  [[ "$name" == *caddy* ]] || continue
  echo "docker stop $name (holds 80/443)"
  docker stop "$name" || true
done

sleep 1
if ss -lptn | grep -Eq ':80 |:443 '; then
  echo "Something is still listening on 80/443:" >&2
  ss -lptn | grep -E ':80 |:443 ' >&2
  echo "Stop that process, then re-run this script." >&2
  exit 1
fi

if [[ "$(cat "$STATE_DIR/nginx")" == "nginx-was-active" ]]; then
  nginx -t
  systemctl start nginx
fi

if [[ -f "$STATE_DIR/docker-stopped.txt" ]]; then
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    if [[ "$name" == *caddy* ]]; then
      echo "skip $name (Caddy stays down so nginx can own 80/443)"
      continue
    fi
    echo "docker start $name"
    docker start "$name" || true
  done <"$STATE_DIR/docker-stopped.txt"
fi

if [[ -f "$STATE_DIR/pm2-stopped" ]] && command -v pm2 >/dev/null 2>&1; then
  pm2 restart all || pm2 resurrect || true
fi

rm -f "$STATE_DIR/paused"
date -u +'%Y-%m-%dT%H:%M:%SZ' >"$STATE_DIR/restored_at"

echo "Restored. Check:"
echo "  systemctl status nginx --no-pager"
echo "  docker ps"
echo "  pm2 list"
echo "  ss -lptn | grep -E ':80 |:443 '"
