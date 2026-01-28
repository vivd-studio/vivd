#!/bin/sh
set -e

echo "Running control-panel database migrations..."
if [ -f "./dist/db/migrate.js" ]; then
  node ./dist/db/migrate.js
else
  npm run db:migrate
fi

exec "$@"

