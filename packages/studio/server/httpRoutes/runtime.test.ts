import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import { describe, expect, it, vi } from "vitest";

import {
  injectBasePathScript,
  rewriteRootAssetUrlsInText,
} from "../http/basePathRewrite.js";
import { resolveForwardedRuntimeBasePath } from "./runtime";
import { registerStudioRuntimeHttpRoutes } from "./runtime";
import { resolveRuntimeRequestedFilePath } from "./runtime";

function createTestRuntimeApp(options?: {
  initialized?: boolean;
  projectPath?: string;
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
    writeUploadedFile: async () => {},
    getProxyBasePath: () => null,
    rewriteRootAssetUrlsInText,
    injectBasePathScript,
    devPreviewProxy: (_req, res) => {
      res.status(200).send("proxied");
    },
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
    const json = vi.fn();
    if (!routeLayer?.route?.stack[0]) {
      throw new Error("Expected /health route");
    }

    routeLayer.route.stack[0].handle({} as any, { json } as any, vi.fn());

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
    const json = vi.fn();
    if (!routeLayer?.route?.stack[0]) {
      throw new Error("Expected /health route");
    }

    routeLayer.route.stack[0].handle({} as any, { json } as any, vi.fn());

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
    const handler = matchingLayers[1]?.handle;
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
    const handler = matchingLayers[1]?.handle;
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
});
