#!/bin/sh
set -e

# Run migrations
echo "Running database migrations..."
npm run db:migrate

# Setup OpenCode Auth
if [ -n "$OPENROUTER_API_KEY" ] || [ -n "$GOOGLE_API_KEY" ]; then
  echo "Setting up OpenCode authentication..."
  mkdir -p /root/.local/share/opencode
# maybe replace with OpenRouter later on
  cat <<EOF > /root/.local/share/opencode/auth.json
{
  "google": {
    "type": "api",
    "key": "${GOOGLE_API_KEY}"
  }
}
EOF
fi

# Execute the passed command
exec "$@"
