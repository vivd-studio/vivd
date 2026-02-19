import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
