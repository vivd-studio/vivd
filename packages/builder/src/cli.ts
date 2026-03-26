import { runProjectArtifactBuild } from "./index.js";
import type { ArtifactBuildKind } from "./storage.js";

function requireNonEmpty(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const organizationId =
    (process.env.VIVD_BUILDER_ORGANIZATION_ID || process.env.VIVD_TENANT_ID || "").trim() ||
    "default";
  const slug = requireNonEmpty("VIVD_PROJECT_SLUG");
  const version = Number.parseInt(requireNonEmpty("VIVD_PROJECT_VERSION"), 10);
  const kind = requireNonEmpty("VIVD_BUILDER_KIND") as ArtifactBuildKind;
  const commitHash = (process.env.VIVD_BUILD_COMMIT_HASH || "").trim() || undefined;

  if (!Number.isFinite(version) || version <= 0) {
    throw new Error(`Invalid VIVD_PROJECT_VERSION: ${process.env.VIVD_PROJECT_VERSION || ""}`);
  }
  if (kind !== "preview" && kind !== "published") {
    throw new Error(`Invalid VIVD_BUILDER_KIND: ${kind}`);
  }

  const result = await runProjectArtifactBuild({
    organizationId,
    slug,
    version,
    kind,
    commitHash,
  });
  console.log(
    `[Builder] ${organizationId}/${slug}/v${version} ${kind} -> ${result.status} (${result.framework})`,
  );
}

main().catch((error) => {
  console.error("[Builder] Failed:", error);
  process.exit(1);
});
