import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";
import { STUDIO_CHAT_ATTACHMENT_MAX_FILES } from "@studio/shared/chatAttachmentPolicy";

import {
  injectBasePathScript,
  rewriteRootAssetUrlsInText,
} from "../http/basePathRewrite.js";
import { devServerService } from "../services/project/DevServerService.js";
import type { RuntimeQuiesceStatus } from "../services/runtime/RuntimeQuiesceCoordinator.js";
import { resolveForwardedRuntimeBasePath } from "./runtime";
import { registerStudioRuntimeHttpRoutes } from "./runtime";
import { resolveRuntimeRequestedFilePath } from "./runtime";

function createTestRuntimeApp(options?: {
  initialized?: boolean;
  projectPath?: string;
  writeUploadedFile?: (fullPath: string, buffer: Buffer) => Promise<void>;
  getProxyBasePath?: (req: express.Request) => string | null;
  devPreviewProxy?: express.RequestHandler;
  onRuntimeActivity?: () => void;
  drainRuntimeTransportForSuspend?: () => void;
  runtimeQuiesceCoordinator?: {
    getQuiesceStatus: () => RuntimeQuiesceStatus;
    quiesceForSuspend: (
      options: { projectDir: string | null },
    ) => Promise<RuntimeQuiesceStatus>;
    resumeAfterActivity: () => Promise<void> | void;
  };
}) {
  const app = express();
  const authMiddleware = vi.fn((_req, _res, next) => next());
  const initialized = options?.initialized ?? true;
  const projectPath = options?.projectPath ?? "/tmp";

  registerStudioRuntimeHttpRoutes({
    app,
    workspace: {
      isInitialized: () => initialized,
      getProjectPath: () => projectPath,
    } as any,
    requireStudioAuth: () => authMiddleware,
    upload: multer({ storage: multer.memoryStorage() }),
    getSingleRouteParam: (value) => {
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      return null;
    },
    decodeUriPath: (value) => {
      try {
        return decodeURI(value);
      } catch {
        return null;
      }
    },
    isAllowedProjectFile: () => true,
    safeJoin: (root, targetPath) => {
      const resolvedRoot = path.resolve(root);
      const resolvedTarget = path.resolve(resolvedRoot, targetPath);
      if (
        resolvedTarget !== resolvedRoot &&
        !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
      ) {
        throw new Error("Invalid path");
      }
      return resolvedTarget;
    },
    writeUploadedFile:
      options?.writeUploadedFile ??
      (async (fullPath, buffer) => {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, buffer);
      }),
    getProxyBasePath: options?.getProxyBasePath ?? (() => null),
    rewriteRootAssetUrlsInText,
    injectBasePathScript,
    devPreviewProxy:
      options?.devPreviewProxy ??
      ((_req, res) => {
        res.status(200).send("proxied");
      }),
    onRuntimeActivity: options?.onRuntimeActivity,
    drainRuntimeTransportForSuspend: options?.drainRuntimeTransportForSuspend,
    runtimeQuiesceCoordinator: options?.runtimeQuiesceCoordinator,
  });

  return { app, authMiddleware };
}

async function startRuntimeServer(app: express.Express) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected runtime server to bind to a TCP port");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function createTempPreviewProject() {
  const projectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vivd-studio-runtime-preview-"),
  );
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "index.html"),
    `<!doctype html>
<html>
  <head>
    <script src="/assets/app.js"></script>
  </head>
  <body>
    <a href="/about">About</a>
  </body>
</html>`,
  );
  fs.writeFileSync(
    path.join(projectDir, "assets", "app.js"),
    'console.log("app");',
  );

  return projectDir;
}
describe("resolveForwardedRuntimeBasePath", () => {
  it("keeps the route base path unchanged without a forwarded prefix", () => {
    expect(resolveForwardedRuntimeBasePath("/vivd-studio/api/preview/site/v1", null)).toBe(
      "/vivd-studio/api/preview/site/v1",
    );
  });

  it("prefixes runtime routes with the forwarded base path", () => {
    expect(
      resolveForwardedRuntimeBasePath(
        "/vivd-studio/api/preview/site/v1",
        "/_studio/runtime-123",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio/api/preview/site/v1");
  });

  it("normalizes trailing slashes before joining", () => {
    expect(
      resolveForwardedRuntimeBasePath(
        "/vivd-studio/api/preview/site/v1/",
        "/_studio/runtime-123/",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio/api/preview/site/v1");
  });
});

describe("resolveRuntimeRequestedFilePath", () => {
  const decodeUriPath = (value: string) => {
    try {
      return decodeURI(value);
    } catch {
      return null;
    }
  };

  it("prefers the query path for hidden working files", () => {
    expect(
      resolveRuntimeRequestedFilePath({
        restPath: "",
        queryPath: ".vivd/uploads/hero.webp",
        decodeUriPath,
      }),
    ).toBe(".vivd/uploads/hero.webp");
  });

  it("decodes encoded query paths for hidden working files", () => {
    expect(
      resolveRuntimeRequestedFilePath({
        restPath: "",
        queryPath: ".vivd%2Fuploads%2Fhero%20image.webp",
        decodeUriPath,
      }),
    ).toBe(".vivd/uploads/hero image.webp");
  });

  it("falls back to the pathname segments for regular files", () => {
    expect(
      resolveRuntimeRequestedFilePath({
        restPath: "images/hero.webp",
        queryPath: undefined,
        decodeUriPath,
      }),
    ).toBe("images/hero.webp");
  });
});

describe("registerStudioRuntimeHttpRoutes", () => {
  it("reports ok health once the workspace is initialized", () => {
    const { app } = createTestRuntimeApp({ initialized: true });
    const routeLayer = app.router.stack.find(
      (layer: any) => layer.route?.path === "/health",
    );
    const set = vi.fn();
    const json = vi.fn();
    if (!routeLayer?.route?.stack[0]) {
      throw new Error("Expected /health route");
    }

    routeLayer.route.stack[0].handle({} as any, { set, json } as any, vi.fn());

    expect(set).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(json).toHaveBeenCalledWith({
      status: "ok",
      initialized: true,
    });
  });

  it("reports starting health while the workspace is still opening", () => {
    const { app } = createTestRuntimeApp({ initialized: false });
    const routeLayer = app.router.stack.find(
      (layer: any) => layer.route?.path === "/health",
    );
    const set = vi.fn();
    const json = vi.fn();
    if (!routeLayer?.route?.stack[0]) {
      throw new Error("Expected /health route");
    }

    routeLayer.route.stack[0].handle({} as any, { set, json } as any, vi.fn());

    expect(set).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
    expect(json).toHaveBeenCalledWith({
      status: "starting",
      initialized: false,
    });
  });

  it("registers the bootstrap endpoint without runtime auth middleware in front of it", () => {
    const { app, authMiddleware } = createTestRuntimeApp();
    const routeLayer = app.router.stack.find(
      (layer: any) => layer.route?.path === "/vivd-studio/api/bootstrap",
    );

    expect(routeLayer?.route?.stack[0]?.handle).not.toBe(authMiddleware);
  });

  it("treats bodyless cleanup requests as suspend cleanup and drains runtime transport", async () => {
    const quiesceForSuspend = vi.fn(async () => ({
      state: "idle" as const,
      subsystems: {},
      lastQuiescedAt: "2026-04-02T00:00:00.000Z",
    }));
    const drainRuntimeTransportForSuspend = vi.fn();
    const { app } = createTestRuntimeApp({
      initialized: true,
      projectPath: "/tmp/runtime-project",
      drainRuntimeTransportForSuspend,
      runtimeQuiesceCoordinator: {
        getQuiesceStatus: () => ({
          state: "active" as const,
          subsystems: {},
          lastQuiescedAt: null,
        }),
        quiesceForSuspend,
        resumeAfterActivity: vi.fn(),
      },
    });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/vivd-studio/api/cleanup/preview-leave`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("connection")).toBe("close");
      expect(quiesceForSuspend).toHaveBeenCalledWith({
        projectDir: "/tmp/runtime-project",
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(drainRuntimeTransportForSuspend).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it("does not quiesce runtime for browser preview-leave beacons", async () => {
    const quiesceForSuspend = vi.fn(async () => ({
      state: "idle" as const,
      subsystems: {},
      lastQuiescedAt: "2026-04-02T00:00:00.000Z",
    }));
    const drainRuntimeTransportForSuspend = vi.fn();
    const { app } = createTestRuntimeApp({
      initialized: true,
      projectPath: "/tmp/runtime-project",
      drainRuntimeTransportForSuspend,
      runtimeQuiesceCoordinator: {
        getQuiesceStatus: () => ({
          state: "active" as const,
          subsystems: {},
          lastQuiescedAt: null,
        }),
        quiesceForSuspend,
        resumeAfterActivity: vi.fn(),
      },
    });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/vivd-studio/api/cleanup/preview-leave`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          slug: "test-project",
          version: 1,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("connection")).not.toBe("close");
      expect(quiesceForSuspend).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(drainRuntimeTransportForSuspend).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("retains only the newest dropped chat files after repeated uploads", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-studio-runtime-chat-upload-"),
    );
    const { app } = createTestRuntimeApp({
      projectPath: projectDir,
    });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      for (
        let index = 0;
        index < STUDIO_CHAT_ATTACHMENT_MAX_FILES + 2;
        index += 1
      ) {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([`file-${index}`], { type: "text/plain" }),
          `ref-${index}.txt`,
        );

        const response = await fetch(
          `${baseUrl}/vivd-studio/api/upload-dropped-file/demo/1`,
          {
            method: "POST",
            body: formData,
          },
        );

        expect(response.status).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }

      const droppedDir = path.join(projectDir, ".vivd", "dropped-images");
      const remainingFiles = fs.readdirSync(droppedDir);

      expect(remainingFiles).toHaveLength(STUDIO_CHAT_ATTACHMENT_MAX_FILES);
      expect(
        remainingFiles.some((filename) => filename.endsWith("ref-0.txt")),
      ).toBe(false);
      expect(
        remainingFiles.some((filename) => filename.endsWith("ref-1.txt")),
      ).toBe(false);
      expect(
        remainingFiles.some((filename) => filename.endsWith("ref-11.txt")),
      ).toBe(true);
    } finally {
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("supports overriding the destination filename for single-file uploads", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-studio-runtime-upload-override-"),
    );
    const { app } = createTestRuntimeApp({ projectPath: projectDir });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const formData = new FormData();
      formData.append(
        "files",
        new Blob(["updated"], { type: "application/pdf" }),
        "different-name.pdf",
      );

      const response = await fetch(
        `${baseUrl}/vivd-studio/api/upload/demo/1?path=${encodeURIComponent(
          "public/pdfs/products/56",
        )}&filename=${encodeURIComponent("kept-name.pdf")}`,
        {
          method: "POST",
          body: formData,
        },
      );
      const payload = (await response.json()) as { uploaded?: string[] };

      expect(response.status).toBe(200);
      expect(payload.uploaded).toEqual(["public/pdfs/products/56/kept-name.pdf"]);
      expect(
        fs.readFileSync(
          path.join(projectDir, "public/pdfs/products/56/kept-name.pdf"),
          "utf-8",
        ),
      ).toBe("updated");
      expect(
        fs.existsSync(path.join(projectDir, "public/pdfs/products/56/different-name.pdf")),
      ).toBe(false);
    } finally {
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("registers auth before backend-compatible preview routes", () => {
    const { app, authMiddleware } = createTestRuntimeApp();
    const matchingLayers = app.router.stack.filter(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/preview/site/v1")),
        ),
    );

    expect(matchingLayers[0]?.handle).toBe(authMiddleware);
  });

  it("forwards the path-mounted runtime base path to the live preview proxy", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-studio-runtime-devserver-proxy-"),
    );
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "devserver-project",
        scripts: { dev: "astro dev" },
      }),
    );

    const hasServerSpy = vi
      .spyOn(devServerService, "hasServer")
      .mockReturnValue(true);
    const getDevServerUrlSpy = vi
      .spyOn(devServerService, "getDevServerUrl")
      .mockReturnValue("http://127.0.0.1:4321");
    const getDevServerStatusSpy = vi
      .spyOn(devServerService, "getDevServerStatus")
      .mockReturnValue("ready");

    const { app } = createTestRuntimeApp({
      projectPath: projectDir,
      getProxyBasePath: () => "/_studio/runtime-123",
      devPreviewProxy: ((req, res) => {
        expect((req as any).vivdDevPreviewTarget).toBe("http://127.0.0.1:4321");
        expect((req as any).vivdDevPreviewBasePath).toBe("/_studio/runtime-123");
        res.status(200).send("proxied");
      }) as express.RequestHandler,
    });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toBe("proxied");
    } finally {
      hasServerSpy.mockRestore();
      getDevServerUrlSpy.mockRestore();
      getDevServerStatusSpy.mockRestore();
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("serves hidden .vivd files through the project file route", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-studio-runtime-projects-"),
    );
    const fullPath = path.join(projectDir, ".vivd", "uploads", "hero.webp");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from("webp-bytes"));

    const { app } = createTestRuntimeApp({
      projectPath: projectDir,
    });
    const matchingLayers = app.router.stack.filter(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/projects/demo/v1")),
        ),
    );
    const handler = matchingLayers[matchingLayers.length - 1]?.handle;
    if (!handler) {
      throw new Error("Expected project file route handler");
    }

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      sendFile: vi.fn(),
      type: vi.fn(),
    } as any;

    try {
      await handler(
        {
          path: "/demo/v1",
          query: { path: ".vivd/uploads/hero.webp" },
        } as any,
        res,
        vi.fn(),
      );

      expect(res.type).not.toHaveBeenCalled();
      expect(res.sendFile).toHaveBeenCalledWith(fullPath, {
        dotfiles: "allow",
      });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("serves hidden .vivd files through the asset file route", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-studio-runtime-assets-"),
    );
    const fullPath = path.join(projectDir, ".vivd", "uploads", "hero.webp");
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from("webp-bytes"));

    const { app } = createTestRuntimeApp({
      projectPath: projectDir,
    });
    const matchingLayers = app.router.stack.filter(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/assets/demo/1")),
        ),
    );
    const handler = matchingLayers[matchingLayers.length - 1]?.handle;
    if (!handler) {
      throw new Error("Expected asset file route handler");
    }

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      sendFile: vi.fn(),
      type: vi.fn(),
    } as any;

    try {
      await handler(
        {
          path: "/demo/1",
          query: { path: ".vivd/uploads/hero.webp" },
        } as any,
        res,
        vi.fn(),
      );

      expect(res.type).not.toHaveBeenCalled();
      expect(res.sendFile).toHaveBeenCalledWith(fullPath, {
        dotfiles: "allow",
      });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("serves root live preview HTML without compat path rewriting", async () => {
    const projectDir = createTempPreviewProject();
    const { app } = createTestRuntimeApp({ projectPath: projectDir });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('/assets/app.js');
      expect(html).toContain('/vivd-studio/api/preview-bridge.js');
      expect(html).not.toContain('/preview/assets/app.js');
      expect(html).not.toContain('__vivdBasePath');
    } finally {
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("serves mounted preview HTML with a prefixed preview bridge script", async () => {
    const projectDir = createTempPreviewProject();
    const { app } = createTestRuntimeApp({
      projectPath: projectDir,
      getProxyBasePath: () => "/_studio/runtime-123",
    });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(
        `${baseUrl}/vivd-studio/api/preview/demo/v1/index.html`,
        {
          headers: {
            "x-forwarded-prefix": "/_studio/runtime-123",
          },
        },
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain(
        '/_studio/runtime-123/vivd-studio/api/preview-bridge.js',
      );
      expect(html).not.toContain(
        'src="/vivd-studio/api/preview-bridge.js"',
      );
    } finally {
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns 404 for the removed legacy /preview transport", async () => {
    const projectDir = createTempPreviewProject();
    const { app } = createTestRuntimeApp({ projectPath: projectDir });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/preview/`);

      expect(response.status).toBe(404);
    } finally {
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns 404 for the removed legacy devpreview transport", async () => {
    const projectDir = createTempPreviewProject();
    const { app } = createTestRuntimeApp({ projectPath: projectDir });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/vivd-studio/api/devpreview/site/v1/`);

      expect(response.status).toBe(404);
    } finally {
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("proxies @vite/client on the runtime root instead of stubbing it", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "vivd-studio-runtime-devserver-root-"),
    );
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "devserver-project",
        scripts: { dev: "vite" },
      }),
    );

    const hasServerSpy = vi
      .spyOn(devServerService, "hasServer")
      .mockReturnValue(true);
    const getDevServerUrlSpy = vi
      .spyOn(devServerService, "getDevServerUrl")
      .mockReturnValue("http://127.0.0.1:4321");

    const { app } = createTestRuntimeApp({ projectPath: projectDir });
    const { server, baseUrl } = await startRuntimeServer(app);

    try {
      const response = await fetch(`${baseUrl}/@vite/client`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toBe("proxied");
    } finally {
      hasServerSpy.mockRestore();
      getDevServerUrlSpy.mockRestore();
      server.close();
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
