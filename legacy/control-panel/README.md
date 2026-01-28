# Vivd Control Panel

Control panel for managing Vivd instances. Creates, monitors, and deploys Vivd instances via the Dokploy API.

## Development

```bash
# Install dependencies
npm install
cd backend && npm install
cd ../frontend && npm install

# Start development servers
npm run dev
```

Backend runs on http://localhost:3100
Frontend runs on http://localhost:5174

## Environment Variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` - PostgreSQL connection string
- `DOKPLOY_URL` - Your Dokploy instance URL
- `DOKPLOY_API_KEY` - API key from Dokploy settings
- `SHARED_*` - Shared API keys for all instances
- `DEFAULT_SCRAPER_*` - Default scraper configuration

## Database

```bash
# Generate migrations
npm run db:generate

# Apply migrations
npm run db:migrate
```

## Deployment

The control panel is deployed via Docker Compose:

```bash
docker compose up -d
```

## Architecture

- **Backend**: Express + tRPC + Drizzle ORM
- **Frontend**: React 19 + Vite 6 + tRPC client
- **Database**: PostgreSQL 17
- **Proxy**: Caddy with automatic HTTPS
