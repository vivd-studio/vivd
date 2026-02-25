#!/bin/sh
set -eu

if [ -f /etc/caddy/Caddyfile ]; then
  mkdir -p /etc/caddy_shared
  cp /etc/caddy/Caddyfile /etc/caddy_shared/Caddyfile
fi

exec "$@"
