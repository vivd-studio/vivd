import type { ProjectVersionManualStatus } from "@vivd/shared/types";
import {
  getCurrentVersion,
  getManifest,
  getVersionData,
} from "../../generator/versionUtils";
import { setProjectVersionStatus } from "./ProjectStatusService";

const MANUAL_FAILED_STATUS_MESSAGE =
  "Status manually set to failed by an organization admin.";
const MANUAL_PAUSED_STATUS_MESSAGE =
  "Initial generation was paused by an organization admin.";

class ProjectStatusOverrideService {
  async setVersionStatus(options: {
    organizationId: string;
    slug: string;
    version?: number;
    status: ProjectVersionManualStatus;
  }): Promise<{
    success: true;
    slug: string;
    version: number;
    previousStatus: string;
    newStatus: ProjectVersionManualStatus;
    message: string;
  }> {
    const manifest = await getManifest(options.organizationId, options.slug);
    if (!manifest) {
      throw new Error("Project not found");
    }

    const targetVersion =
      options.version ??
      (await getCurrentVersion(options.organizationId, options.slug));
    if (targetVersion === 0) {
      throw new Error("No versions found for this project");
    }

    const versionData = await getVersionData(
      options.organizationId,
      options.slug,
      targetVersion,
    );
    const currentStatus = versionData?.status || "unknown";
    const sourceRaw = (versionData?.source ?? manifest.source) as string | undefined;
    const source: "url" | "scratch" =
      sourceRaw === "scratch" ? "scratch" : manifest.url ? "url" : "scratch";

    if (options.status === "initial_generation_paused" && source !== "scratch") {
      throw new Error(
        "Only scratch projects can be set to an initial-generation paused status.",
      );
    }

    const errorMessage =
      options.status === "failed"
        ? versionData?.errorMessage ?? MANUAL_FAILED_STATUS_MESSAGE
        : options.status === "initial_generation_paused"
          ? versionData?.errorMessage ?? MANUAL_PAUSED_STATUS_MESSAGE
          : undefined;

    await setProjectVersionStatus({
      organizationId: options.organizationId,
      slug: options.slug,
      version: targetVersion,
      status: options.status,
      errorMessage,
    });

    return {
      success: true,
      slug: options.slug,
      version: targetVersion,
      previousStatus: currentStatus,
      newStatus: options.status,
      message: `Updated ${options.slug} v${targetVersion} from '${currentStatus}' to '${options.status}'`,
    };
  }
}

export const projectStatusOverrideService = new ProjectStatusOverrideService();
