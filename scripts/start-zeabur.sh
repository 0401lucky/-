#!/bin/sh
set -eu

WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-8081}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"

export PORT="$GATEWAY_PORT"
export API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:${API_PORT}}"
export WEB_UPSTREAM="${WEB_UPSTREAM:-127.0.0.1:${WEB_PORT}}"

cleanup() {
  kill 0 >/dev/null 2>&1 || true
}

trap cleanup INT TERM

APP_MODE=api PORT="$API_PORT" /app/api &
API_PID=$!

APP_MODE=worker /app/worker &
WORKER_PID=$!

PORT="$WEB_PORT" node /app/server.js &
WEB_PID=$!

caddy run --config /app/gateway/Caddyfile --adapter caddyfile &
CADDY_PID=$!

while true; do
  for pid in "$API_PID" "$WORKER_PID" "$WEB_PID" "$CADDY_PID"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      cleanup
      exit 1
    fi
  done
  sleep 2
done
