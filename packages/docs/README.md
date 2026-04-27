# @vivd/docs

Public product documentation for Vivd.

This workspace is intentionally separate from the repo-root `plans/` directory:

- `packages/docs`: public, task-focused product docs for Vivd users, including the `solo` self-host path.
- `plans/`: internal plans, architecture notes, and contributor-only material.

## Run in monorepo

```bash
npm run dev -w @vivd/docs
npm run build -w @vivd/docs
```

For end-to-end routing checks through Caddy, use the repo-level Docker compose stack and open `http://docs.localhost`.
