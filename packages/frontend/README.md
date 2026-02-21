# @vivd/frontend

Control-plane React app for Vivd.

This package serves the dashboard/admin UX and embedded Studio entry points behind `/vivd-studio`.

## Run in monorepo

Use workspace scripts from repo root:

```bash
npm run dev -w @vivd/frontend
npm run build -w @vivd/frontend
npm run test:run -w @vivd/frontend
```

For full local stack behavior (Caddy routing, backend, DB), use repo-level Docker compose from root.
