#!/bin/sh
set -e

# Run migrations
echo "Running database migrations..."
npm run db:migrate

# Execute the passed command
exec "$@"
