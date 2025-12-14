/**
 * One-time migration script to convert existing projects to versioned structure.
 *
 * Run this once with: npx tsx src/scripts/migrate-to-versions.ts
 *
 * After running, all projects in generated/<slug>/ will be migrated to generated/<slug>/v1/
 */

import * as fs from "fs";
import * as path from "path";

const GENERATED_DIR = path.join(process.cwd(), "generated");

interface ProjectManifest {
  url: string;
  createdAt: string;
  currentVersion: number;
  versions: {
    version: number;
    createdAt: string;
    status: string;
  }[];
}

function isLegacyProject(projectDir: string): boolean {
  const manifestPath = path.join(projectDir, "manifest.json");

  // If manifest exists, it's already migrated
  if (fs.existsSync(manifestPath)) {
    return false;
  }

  // Check if there are files directly in the project folder (legacy structure)
  const hasDirectFiles =
    fs.existsSync(path.join(projectDir, "index.html")) ||
    fs.existsSync(path.join(projectDir, "project.json"));

  return hasDirectFiles;
}

function migrateProject(slug: string): boolean {
  const projectDir = path.join(GENERATED_DIR, slug);

  if (!isLegacyProject(projectDir)) {
    console.log(`  [SKIP] ${slug} - already migrated or not a legacy project`);
    return false;
  }

  console.log(`  [MIGRATE] ${slug}...`);

  const v1Dir = path.join(projectDir, "v1");

  // Create v1 directory
  fs.mkdirSync(v1Dir, { recursive: true });

  // Read existing project.json if it exists for metadata
  let legacyProjectData: any = {};
  const legacyProjectJsonPath = path.join(projectDir, "project.json");
  if (fs.existsSync(legacyProjectJsonPath)) {
    try {
      legacyProjectData = JSON.parse(
        fs.readFileSync(legacyProjectJsonPath, "utf-8")
      );
    } catch (e) {
      console.error(`    Error reading legacy project.json for ${slug}:`, e);
    }
  }

  // Get all items in the project folder
  const items = fs.readdirSync(projectDir, { withFileTypes: true });

  // Move all items to v1 (except v1 itself and manifest.json if somehow exists)
  for (const item of items) {
    if (item.name === "v1" || item.name === "manifest.json") {
      continue;
    }

    const sourcePath = path.join(projectDir, item.name);
    const destPath = path.join(v1Dir, item.name);

    fs.renameSync(sourcePath, destPath);
    console.log(`    Moved: ${item.name}`);
  }

  // Update the project.json in v1 to include version number
  const v1ProjectJsonPath = path.join(v1Dir, "project.json");
  if (fs.existsSync(v1ProjectJsonPath)) {
    try {
      const projectData = JSON.parse(
        fs.readFileSync(v1ProjectJsonPath, "utf-8")
      );
      projectData.version = 1;
      fs.writeFileSync(v1ProjectJsonPath, JSON.stringify(projectData, null, 2));
    } catch (e) {
      console.error(`    Error updating v1 project.json for ${slug}:`, e);
    }
  }

  // Create manifest
  const manifest: ProjectManifest = {
    url: legacyProjectData.url || "",
    createdAt: legacyProjectData.createdAt || new Date().toISOString(),
    currentVersion: 1,
    versions: [
      {
        version: 1,
        createdAt: legacyProjectData.createdAt || new Date().toISOString(),
        status: legacyProjectData.status || "completed",
      },
    ],
  };

  const manifestPath = path.join(projectDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`    Created manifest.json`);

  console.log(`  [DONE] ${slug} migrated to v1`);
  return true;
}

function main() {
  console.log("=== Project Versioning Migration ===\n");

  if (!fs.existsSync(GENERATED_DIR)) {
    console.log("No generated/ directory found. Nothing to migrate.");
    return;
  }

  const items = fs.readdirSync(GENERATED_DIR, { withFileTypes: true });
  const projectDirs = items.filter((item) => item.isDirectory());

  console.log(`Found ${projectDirs.length} project(s) to check.\n`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const dir of projectDirs) {
    const migrated = migrateProject(dir.name);
    if (migrated) {
      migratedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log("\n=== Migration Complete ===");
  console.log(`Migrated: ${migratedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Total: ${projectDirs.length}`);
}

main();
