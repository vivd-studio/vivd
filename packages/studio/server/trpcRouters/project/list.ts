import { isConnectedMode } from "@vivd/shared";
import { publicProcedure } from "../../trpc/trpc.js";
import { callConnectedBackendQuery } from "../project.shared.js";
import { getConnectedSupportEmail } from "./connected.js";
import {
  readEnabledPluginsFromEnv,
  readProjectSlugFromEnv,
  readSupportEmailFromEnv,
} from "./env.js";
import type { ConnectedProjectListRow } from "./types.js";

export const projectListProcedures = {
  list: publicProcedure.query(async ({ ctx }) => {
    let supportEmail = readSupportEmailFromEnv();
    const runtimeProjectSlug = readProjectSlugFromEnv() ?? "studio";

    if (!ctx.workspace.isInitialized()) {
      return { projects: [], supportEmail };
    }

    const connectedProjectSlug = readProjectSlugFromEnv();
    if (isConnectedMode() && connectedProjectSlug) {
      supportEmail = (await getConnectedSupportEmail(ctx)) ?? supportEmail;

      try {
        const connectedProjects = await callConnectedBackendQuery<{
          projects?: ConnectedProjectListRow[];
        }>(ctx, "project.list", {});
        const connectedProject = connectedProjects.projects?.find(
          (project) => project.slug === connectedProjectSlug,
        );

        if (connectedProject) {
          return {
            supportEmail,
            projects: [connectedProject],
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[Studio project.list] Falling back to runtime env plugins for ${connectedProjectSlug}: ${message}`,
        );
      }
    }

    const enabledPlugins = readEnabledPluginsFromEnv();

    return {
      supportEmail,
      projects: [
        {
          slug: runtimeProjectSlug,
          status: "completed",
          url: null,
          source: "scratch",
          title: runtimeProjectSlug,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentVersion: 1,
          totalVersions: 1,
          versions: [{ version: 1, status: "completed" }],
          publishedDomain: null,
          publishedVersion: null,
          thumbnailUrl: null,
          enabledPlugins,
        },
      ],
    };
  }),

  getVersions: publicProcedure.query(async () => ({
    versions: [
      {
        version: 0,
        status: "current",
        description: "Working copy",
      },
    ],
    totalVersions: 1,
  })),
};
