import { migrateProjectMetadataToDbFromFilesystem } from "../services/project/ProjectMetaMigrationService";

async function main() {
  const res = await migrateProjectMetadataToDbFromFilesystem({
    includeProjectResults: true,
  });

  if (res.projectsScanned === 0) {
    console.log("[migrate-project-metadata-to-db] No projects found on disk.");
    return;
  }

  console.log(
    `[migrate-project-metadata-to-db] Migrated ${res.projectsMigrated}/${res.projectsScanned} projects (tenant: ${res.tenantId})`,
  );

  for (const p of res.projects ?? []) {
    console.log(
      `[migrate-project-metadata-to-db] ${p.slug}: versions=${p.versionsUpserted}, checklists=${p.checklistsUpserted}, thumbnails=${p.thumbnailsUploaded}`,
    );
  }

  console.log(
    `[migrate-project-metadata-to-db] Done. versions=${res.versionsUpserted}, checklists=${res.checklistsUpserted}, thumbnails=${res.thumbnailsUploaded}, errors=${res.errors.length}`,
  );
  if (res.errors.length) {
    for (const e of res.errors.slice(0, 10)) {
      console.warn(`[migrate-project-metadata-to-db] ERROR ${e.slug}: ${e.error}`);
    }
    if (res.errors.length > 10) {
      console.warn(
        `[migrate-project-metadata-to-db] …and ${res.errors.length - 10} more errors`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate-project-metadata-to-db] Failed:", err);
    process.exit(1);
  });
