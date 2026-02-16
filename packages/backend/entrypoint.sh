#!/bin/sh
set -e

# Run migrations
# Use prod script if dist exists (production), otherwise use tsx (development)
echo "Running database migrations..."
if [ -f "./dist/db/migrate.js" ]; then
  npm run db:migrate:prod
else
  npm run db:migrate
fi

# Execute the passed command
exec "$@"
