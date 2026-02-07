/**
 * One-time migration script to move legacy projects/<slug>/... into
 * projects/tenants/<tenantId>/<slug>/...
 *
 * Usage:
 *   npx tsx src/scripts/migrate-to-tenant-layout.ts --apply
 *
 * Options:
 *   --tenant=<id>   Override tenant id (default: env PROJECTS_TENANT_ID/TENANT_ID or "default")
 *   --apply         Perform the move (default: dry-run)
 */

import * as fs from "fs";
import * as path from "path";
import {
  getActiveTenantId,
  getProjectsRootDir,
  getTenantProjectsDir,
} from "../generator/versionUtils";

type Args = {
  tenantId?: string;
  apply: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") {
      args.apply = true;
      continue;
    }
    if (raw.startsWith("--tenant=")) {
      args.tenantId = raw.slice("--tenant=".length).trim();
      continue;
    }
  }
  return args;
}

function looksLikeProjectDir(dir: string): boolean {
  try {
    const items = fs.readdirSync(dir);
    if (items.includes("manifest.json")) return true;
    if (items.some((name) => /^v\\d+$/.test(name))) return true;
    if (items.includes("index.html") || items.includes("project.json")) return true;
    return false;
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const projectsRoot = getProjectsRootDir();
  const tenantId = args.tenantId || getActiveTenantId();
  const targetRoot = getTenantProjectsDir(tenantId);

  console.log("=== Tenant Layout Migration ===");
  console.log(`Projects root: ${projectsRoot}`);
  console.log(`Tenant id: ${tenantId}`);
  console.log(`Target root: ${targetRoot}`);
  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log("");

  if (!fs.existsSync(projectsRoot)) {
    console.log("No projects directory found. Nothing to migrate.");
    return;
  }

  fs.mkdirSync(targetRoot, { recursive: true });

  const entries = fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== "tenants");

  let moved = 0;
  let skipped = 0;

  for (const slug of entries) {
    const from = path.join(projectsRoot, slug);
    const to = path.join(targetRoot, slug);

    if (!looksLikeProjectDir(from)) {
      console.log(`  [SKIP] ${slug} - does not look like a project directory`);
      skipped++;
      continue;
    }

    if (fs.existsSync(to)) {
      console.log(`  [SKIP] ${slug} - already exists in tenant dir`);
      skipped++;
      continue;
    }

    if (!args.apply) {
      console.log(`  [DRY]  ${slug} -> ${to}`);
      moved++;
      continue;
    }

    fs.renameSync(from, to);
    console.log(`  [MOVE] ${slug} -> ${to}`);
    moved++;
  }

  console.log("");
  console.log("=== Migration Summary ===");
  console.log(`Moved: ${moved}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${entries.length}`);
}

main();

