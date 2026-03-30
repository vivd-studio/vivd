import type http from "node:http";
import type net from "node:net";
import type { Duplex } from "node:stream";

import type { RequestHandler } from "http-proxy-middleware";

import { devServerService } from "../services/project/DevServerService.js";
import {
  detectProjectType,
  type ProjectConfig,
} from "../services/project/projectType.js";
import type { WorkspaceManager } from "../workspace/WorkspaceManager.js";
import { isStudioRequestAuthorized } from "./studioAuth.js";

type DevPreviewProxyRequest = http.IncomingMessage & {
  vivdDevPreviewTarget?: string;
  vivdDevPreviewBasePath?: string;
};

type DevPreviewProxyHandler = Pick<
  RequestHandler<http.IncomingMessage, http.ServerResponse>,
  "upgrade"
>;

type UpgradeWorkspace = Pick<WorkspaceManager, "isInitialized" | "getProjectPath">;
type UpgradeSocket = Duplex & { destroyed?: boolean };

type DevServerDeps = {
  hasServer(): boolean;
  getOrStartDevServer(
    projectDir: string,
    basePath: string,
  ): Promise<{ url: string | null; status: string; error?: string }>;
  getDevServerUrl(): string | null;
  getDevServerStatus(): string;
};

type HandleStudioPreviewUpgradeArgs = {
  req: DevPreviewProxyRequest;
  socket: UpgradeSocket;
  head: Buffer;
  env?: NodeJS.ProcessEnv;
  workspace: UpgradeWorkspace;
  proxy: DevPreviewProxyHandler;
  detectProjectTypeImpl?: (projectDir: string) => ProjectConfig;
  devServerServiceImpl?: DevServerDeps;
};

function getRequestPathname(req: http.IncomingMessage): string {
  const rawUrl = typeof req.url === "string" ? req.url : "/";
  try {
    return new URL(rawUrl, "http://studio.local").pathname;
  } catch {
    return "/";
  }
}

export function shouldHandleStudioPreviewUpgrade(pathname: string): boolean {
  return !(
    pathname === "/health" ||
    pathname.startsWith("/preview") ||
    pathname.startsWith("/vivd-studio") ||
    pathname.startsWith("/trpc")
  );
}

function closeUpgradeWithJsonError(
  socket: UpgradeSocket,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  if (socket.destroyed) return;

  const statusText =
    statusCode === 401
      ? "Unauthorized"
      : statusCode === 404
        ? "Not Found"
        : statusCode === 400
          ? "Bad Request"
          : statusCode === 503
            ? "Service Unavailable"
            : "Bad Gateway";
  const body = JSON.stringify(payload);
  const response =
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: application/json\r\n" +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    "\r\n" +
    body;

  socket.write(response);
  socket.destroy();
}

export async function handleStudioPreviewUpgrade(
  args: HandleStudioPreviewUpgradeArgs,
): Promise<boolean> {
  const pathname = getRequestPathname(args.req);
  if (!shouldHandleStudioPreviewUpgrade(pathname)) {
    return false;
  }

  const auth = isStudioRequestAuthorized(args.req, args.env);
  if (!auth.authorized) {
    closeUpgradeWithJsonError(args.socket, 401, { error: "Unauthorized" });
    return true;
  }

  if (!args.workspace.isInitialized()) {
    closeUpgradeWithJsonError(args.socket, 503, {
      error: "Workspace not initialized",
    });
    return true;
  }

  const projectDir = args.workspace.getProjectPath();
  const detectProjectTypeFn = args.detectProjectTypeImpl ?? detectProjectType;
  const devServer = args.devServerServiceImpl ?? devServerService;
  const config = detectProjectTypeFn(projectDir);

  if (config.mode !== "devserver") {
    closeUpgradeWithJsonError(args.socket, 404, {
      error: "No preview websocket available",
    });
    return true;
  }

  if (!devServer.hasServer()) {
    await devServer.getOrStartDevServer(projectDir, "/");
  }

  const devServerUrl = devServer.getDevServerUrl();
  if (!devServerUrl) {
    closeUpgradeWithJsonError(args.socket, 503, {
      error: "Dev server not running",
      status: devServer.getDevServerStatus(),
    });
    return true;
  }

  args.req.vivdDevPreviewTarget = devServerUrl;
  args.proxy.upgrade(args.req, args.socket as net.Socket, args.head);
  return true;
}
