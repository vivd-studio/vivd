#!/bin/sh
set -eu

if [ -f /etc/caddy/Caddyfile ]; then
  mkdir -p /etc/caddy_shared
  cp /etc/caddy/Caddyfile /etc/caddy_shared/Caddyfile
fi

if [ "$#" -eq 0 ]; then
  set -- caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
elif ! command -v "$1" >/dev/null 2>&1; then
  # Base image passes `run ...` as CMD; when ENTRYPOINT is overridden here we
  # need to prepend the binary name to preserve original behavior.
  set -- caddy "$@"
fi

exec "$@"
