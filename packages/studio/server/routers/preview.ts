import { router, publicProcedure } from "../trpc/trpc.js";
import {
  devServerService,
  DevServerService,
} from "../services/DevServerService.js";
import { detectProjectType } from "../services/projectType.js";

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
      };
    }

    const projectPath = ctx.workspace.getProjectPath();
    const config = detectProjectType(projectPath);
    const devServer = getDevServer();

    if (config.mode === "static") {
      return {
        url: null,
        mode: "static" as const,
        projectType: config.framework,
        projectPath,
        status: "none" as const,
      };
    }

    // Get or start dev server
    const result = await devServer.getOrStartDevServer(projectPath);

    return {
      url: result.url,
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
      url: devServer.getDevServerUrl(),
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
