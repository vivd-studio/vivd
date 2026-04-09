import type { InitialGenerationState } from "@vivd/shared/types";
import {
  getVersionDir,
} from "../../generator/versionUtils";
import {
  readInitialGenerationManifest,
  writeInitialGenerationManifest,
} from "../../generator/initialGeneration";
import { projectMetaService } from "./ProjectMetaService";

type SyncedInitialGenerationStatus = Extract<
  InitialGenerationState,
  "generating_initial_site" | "initial_generation_paused" | "completed" | "failed"
>;

function syncScratchInitialGenerationManifestStatus(options: {
  versionDir: string;
  status: SyncedInitialGenerationStatus;
  sessionId?: string | null;
  errorMessage?: string;
}): void {
  const manifest = readInitialGenerationManifest(options.versionDir);
  if (manifest?.mode !== "studio_astro") return;

  const nextSessionId = options.sessionId ?? manifest.sessionId ?? null;
  const now = new Date().toISOString();

  writeInitialGenerationManifest(options.versionDir, {
    ...manifest,
    state: options.status,
    sessionId: nextSessionId,
    startedAt:
      options.status === "generating_initial_site"
        ? manifest.startedAt ?? now
        : manifest.startedAt ?? (nextSessionId ? now : null),
    completedAt:
      options.status === "completed" || options.status === "failed" ? now : null,
    errorMessage:
      options.status === "failed" ||
      options.status === "initial_generation_paused"
        ? options.errorMessage ?? manifest.errorMessage ?? "Initial generation failed."
        : null,
  });
}

export async function setProjectVersionStatus(options: {
  organizationId: string;
  slug: string;
  version: number;
  status: string;
  errorMessage?: string;
  sessionId?: string | null;
}): Promise<void> {
  const versionDir = getVersionDir(
    options.organizationId,
    options.slug,
    options.version,
  );

  if (
    options.status === "generating_initial_site" ||
    options.status === "initial_generation_paused" ||
    options.status === "completed" ||
    options.status === "failed"
  ) {
    syncScratchInitialGenerationManifestStatus({
      versionDir,
      status: options.status,
      errorMessage: options.errorMessage,
      sessionId: options.sessionId,
    });
  }

  await projectMetaService.updateVersionStatus({
    organizationId: options.organizationId,
    slug: options.slug,
    version: options.version,
    status: options.status,
    errorMessage: options.errorMessage,
  });
}
