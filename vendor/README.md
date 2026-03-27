# Local Upstream References

This directory is reserved for local upstream/reference checkouts that Vivd contributors and agents may inspect while working in this repo.

- `opencode`: upstream OpenCode reference checkout.
- `dokploy`: upstream Dokploy reference checkout for deployment/hosting ideas Vivd may selectively borrow.
- `dyad`: upstream Dyad reference checkout for local-first AI app-builder, packaging, and monetization comparisons.

Rules:

- Keep these repos out of the npm workspace/build graph.
- Treat them as reference material, not runtime dependencies.
- Keep stable paths documented in `AGENTS.md` so the agent can rely on them.
