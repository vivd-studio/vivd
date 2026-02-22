import { router, publicProcedure } from "../trpc/trpc.js";
import {
  devServerService,
  DevServerService,
} from "../services/project/DevServerService.js";
import { detectProjectType } from "../services/project/projectType.js";

// Use singleton or create instance per workspace
let studioDevServer: DevServerService | null = null;

function getDevServer(): DevServerService {
  if (!studioDevServer) {
    studioDevServer = devServerService;
  }
  return studioDevServer;
}

export const previewRouter = router({
  getInfo: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return {
        url: null,
        mode: "static" as const,
        projectType: "unknown",
        projectPath: null,
        status: "none" as const,
        error: "Workspace not initialized",
      };
    }

    const projectPath = ctx.workspace.getProjectPath();
    const config = detectProjectType(projectPath);
    const devServer = getDevServer();
    const previewUrl = "/preview/";

    if (config.mode === "static") {
      return {
        url: previewUrl,
        mode: "static" as const,
        projectType: config.framework,
        projectPath,
        status: "ready" as const,
        error: undefined,
      };
    }

    // Get or start dev server
    const result = await devServer.getOrStartDevServer(projectPath, "/preview");

    return {
      url: previewUrl,
      mode: "dev-server" as const,
      projectType: config.framework,
      projectPath,
      status: result.status,
      error: result.error,
    };
  }),

  getStatus: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return { status: "none" as const };
    }

    const devServer = getDevServer();
    const status = devServer.getDevServerStatus();

    return {
      status,
      url: status === "ready" ? "/preview/" : null,
    };
  }),

  keepAlive: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return { success: false };
    }

    const devServer = getDevServer();
    devServer.touch();

    return { success: true };
  }),

  stop: publicProcedure.mutation(async () => {
    const devServer = getDevServer();
    devServer.stopDevServer();

    return { success: true };
  }),

  restart: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return { success: false, error: "Workspace not initialized" };
    }

    const projectPath = ctx.workspace.getProjectPath();
    const devServer = getDevServer();

    // Stop existing server
    devServer.stopDevServer();

    // Start new server
    const result = await devServer.getOrStartDevServer(projectPath);

    return {
      success: result.status !== "error",
      url: result.url,
      status: result.status,
      error: result.error,
    };
  }),
});
