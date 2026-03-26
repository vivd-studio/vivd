import express from "express";
import multer from "multer";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import { resolveForwardedRuntimeBasePath } from "./runtime";
import { registerStudioRuntimeHttpRoutes } from "./runtime";

function createTestRuntimeApp(options?: { initialized?: boolean }) {
  const app = express();
  const authMiddleware = vi.fn((_req, _res, next) => next());
  const initialized = options?.initialized ?? true;

  registerStudioRuntimeHttpRoutes({
    app,
    workspace: {
      isInitialized: () => initialized,
      getProjectPath: () => "/tmp",
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
    rewriteRootAssetUrlsInText: (text) => text,
    injectBasePathScript: (html) => html,
    devPreviewProxy: (_req, res) => {
      res.status(200).send("proxied");
    },
  });

  return { app, authMiddleware };
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
        "/vivd-studio/api/devpreview/site/v1/",
        "/_studio/runtime-123/",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio/api/devpreview/site/v1");
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

  it("registers auth before /preview", () => {
    const { app, authMiddleware } = createTestRuntimeApp();
    const matchingLayers = app.router.stack.filter(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/preview")),
        ),
    );

    expect(matchingLayers[0]?.handle).toBe(authMiddleware);
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

  it("registers auth before backend-compatible devpreview routes", () => {
    const { app, authMiddleware } = createTestRuntimeApp();
    const matchingLayers = app.router.stack.filter(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/api/devpreview/site/v1")),
        ),
    );

    expect(matchingLayers[0]?.handle).toBe(authMiddleware);
  });
});
