import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.PUBLIC_VIVD_DOCS_SKIP_SELF_HOST_ASSET_SYNC === "true") {
  console.log("[docs] Skipping self-host asset sync by request.");
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const syncScriptPath = path.resolve(repoRoot, "scripts/sync-self-host-assets.ts");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", syncScriptPath],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status ?? 1);
