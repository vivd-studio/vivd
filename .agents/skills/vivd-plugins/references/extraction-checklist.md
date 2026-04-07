# Plugin Extraction Checklist

Use this when moving a Vivd plugin into its own workspace package.

## Contract

- Move plugin-owned config schema into the plugin package.
- Move plugin-owned shared UI metadata into the plugin package.
- Use shared plugin contracts from `packages/shared/src/types/pluginContracts.ts`.
- Do not let the plugin package import `@vivd/backend/src/...` only for contract types.

## Backend

- Keep the host registry in `packages/backend/src/services/plugins/registry.ts`.
- Prefer a host adapter that binds backend services into a plugin-owned factory/module.
- Keep plugin-specific compatibility routers thin.
- If the plugin still needs special backend payloads, keep them plugin-owned or behind a thin host adapter.

## Frontend

- Register the plugin page/module in `packages/frontend/src/plugins/registry.tsx`.
- Register plugin-owned shared UI metadata in the frontend shared UI registry.
- Keep `packages/frontend/src/pages/*` compatibility exports thin.
- Do not add new hardcoded plugin conditionals to unrelated host components.

## Studio

- Register plugin-owned shared UI metadata in the Studio shared UI registry when Studio shortcuts or toolbar entries are needed.
- Add typecheck path aliases if Studio client imports plugin package source directly.

## CLI

- Keep the grammar in `packages/cli/src/commands.ts`.
- Register plugin-owned help, aliases, and renderers through `packages/cli/src/plugins/registry.ts`.
- Prefer a thin local CLI adapter over importing plugin packages all over the CLI host.

## Workspace Plumbing

- Add the plugin workspace dependency to every host workspace that imports it.
- Refresh the root `package-lock.json`.
- Update Dockerfiles to copy the plugin `package.json`, include the workspace in `npm ci -w ...`, and copy plugin source where needed.
- Update `docker-compose.override.yml` `develop.watch` rules so backend/frontend/studio containers sync the plugin workspace during local dev.

## Validation

- `npm run typecheck -w @vivd/shared`
- `npm run typecheck -w <plugin workspace>`
- `npm run typecheck -w @vivd/backend`
- `npm run typecheck -w @vivd/frontend`
- `npm run typecheck -w @vivd/studio`
- `npm run typecheck -w @vivd/cli`
- `npm run build -w @vivd/backend`
- `npm run build -w @vivd/frontend`
