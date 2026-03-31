import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backendRoot = resolve(__dirname, "..");
const repoRoot = resolve(__dirname, "../../..");

const envFiles = [
  resolve(backendRoot, ".env.test.local"),
  resolve(backendRoot, ".env.test"),
  resolve(backendRoot, ".env.local"),
  resolve(backendRoot, ".env"),
  resolve(repoRoot, ".env.test.local"),
  resolve(repoRoot, ".env.test"),
  resolve(repoRoot, ".env.local"),
  resolve(repoRoot, ".env"),
];

for (const envFile of envFiles) {
  if (!existsSync(envFile)) continue;
  config({
    path: envFile,
    override: false,
    quiet: true,
  });
}

if (!(process.env.FLY_STUDIO_RUNTIME_ROUTES_DIR || "").trim()) {
  const tempRoutesDir = mkdtempSync(join(os.tmpdir(), "vivd-fly-routes-"));
  process.env.FLY_STUDIO_RUNTIME_ROUTES_DIR = tempRoutesDir;
  process.on("exit", () => {
    rmSync(tempRoutesDir, { recursive: true, force: true });
  });
}
