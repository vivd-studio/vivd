import express from "express";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerStudioClientHttpRoutes } from "./client";

describe("registerStudioClientHttpRoutes", () => {
  let clientDir = "";

  beforeEach(async () => {
    clientDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-studio-client-"));
    await fs.ensureDir(path.join(clientDir, "assets"));
    await fs.writeFile(
      path.join(clientDir, "index.html"),
      "<!doctype html><html><body>studio-shell</body></html>",
    );
    await fs.writeFile(
      path.join(clientDir, "assets", "app.js"),
      'console.log("studio-shell");',
    );
  });

  afterEach(async () => {
    if (clientDir) {
      await fs.remove(clientDir);
    }
  });

  function createApp() {
    const app = express();
    const authMiddleware = vi.fn((_req, _res, next) => next());
    registerStudioClientHttpRoutes({
      app,
      requireStudioAuth: () => authMiddleware,
      clientPath: clientDir,
      clientIndexPath: path.join(clientDir, "index.html"),
      getProxyBasePath: () => null,
      rewriteRootAssetUrlsInText: (html) => html,
      injectBasePathScript: (html) => html,
    });
    return { app, authMiddleware };
  }

  it("registers auth as the first handler for the shell entry routes", () => {
    const { app, authMiddleware } = createApp();
    const routes = app.router.stack.filter((layer: any) => layer.route);

    const studioRoute = routes.find((layer: any) => layer.route.path === "/vivd-studio");
    const studioSlashRoute = routes.find((layer: any) => layer.route.path === "/vivd-studio/");

    expect(routes.some((layer: any) => layer.route.path === "/")).toBe(false);
    expect(studioRoute?.route?.stack[0]?.handle).toBe(authMiddleware);
    expect(studioSlashRoute?.route?.stack[0]?.handle).toBe(authMiddleware);
  });

  it("registers auth ahead of the static /vivd-studio asset handler", () => {
    const { app, authMiddleware } = createApp();
    const matchingLayers = app.router.stack.filter(
      (layer: any) =>
        !layer.route &&
        Array.isArray(layer.matchers) &&
        layer.matchers.some((matcher: (pathname: string) => unknown) =>
          Boolean(matcher("/vivd-studio/assets/app.js")),
        ),
    );

    expect(matchingLayers[0]?.handle).toBe(authMiddleware);
  });
});
