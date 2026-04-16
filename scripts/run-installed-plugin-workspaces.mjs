import { spawnSync } from "node:child_process";
import { installedPluginPackageNames } from "../plugins/installed/registry.helpers.mjs";

const [scriptName, ...scriptArgs] = process.argv.slice(2);

if (!scriptName) {
  console.error(
    "Usage: node ./scripts/run-installed-plugin-workspaces.mjs <script> [...args]",
  );
  process.exit(1);
}

for (const workspace of installedPluginPackageNames) {
  const result = spawnSync(
    "npm",
    ["run", scriptName, "--workspace", workspace, ...scriptArgs],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
