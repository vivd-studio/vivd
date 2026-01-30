#!/bin/sh
set -e

# Setup OpenCode Auth (mirrors `packages/backend/entrypoint.sh`)
if [ -n "$GOOGLE_API_KEY" ]; then
  echo "Setting up OpenCode authentication..."
  mkdir -p /root/.local/share/opencode

  cat <<EOF > /root/.local/share/opencode/auth.json
{
  "google": {
    "type": "api",
    "key": "${GOOGLE_API_KEY}"
  }
}
EOF
fi

exec "$@"

