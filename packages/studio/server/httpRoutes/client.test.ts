import express from "express";
import fs from "fs-extra";
import type { Server } from "node:http";
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

  function createApp(options?: {
    resolveInitialGenerationSessionId?: (
      req: express.Request,
    ) => Promise<string | null>;
  }) {
    const app = express();
    const authMiddleware = vi.fn((_req, _res, next) => next());
    registerStudioClientHttpRoutes({
      app,
      requireStudioAuth: () => authMiddleware,
      clientPath: clientDir,
      clientIndexPath: path.join(clientDir, "index.html"),
      resolveInitialGenerationSessionId: options?.resolveInitialGenerationSessionId,
      getProxyBasePath: () => null,
      rewriteRootAssetUrlsInText: (html) => html,
      injectBasePathScript: (html) => html,
    });
    return { app, authMiddleware };
  }

  async function startServer(app: express.Express): Promise<{
    server: Server;
    baseUrl: string;
  }> {
    const server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected client test server to bind to a TCP port");
    }

    return {
      server,
      baseUrl: `http://127.0.0.1:${address.port}`,
    };
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

  it("redirects initial-generation shell requests to a resolved session id", async () => {
    const resolveInitialGenerationSessionId = vi
      .fn()
      .mockResolvedValue("sess-initial");
    const { app } = createApp({
      resolveInitialGenerationSessionId,
    });
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(
        `${baseUrl}/vivd-studio?initialGeneration=1&projectSlug=site-1&version=1`,
        {
          redirect: "manual",
        },
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "/vivd-studio?initialGeneration=1&projectSlug=site-1&version=1&sessionId=sess-initial",
      );
      expect(resolveInitialGenerationSessionId).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("serves the shell without resolving a session when one is already present", async () => {
    const resolveInitialGenerationSessionId = vi
      .fn()
      .mockResolvedValue("sess-should-not-be-used");
    const { app } = createApp({
      resolveInitialGenerationSessionId,
    });
    const { server, baseUrl } = await startServer(app);

    try {
      const response = await fetch(
        `${baseUrl}/vivd-studio?initialGeneration=1&projectSlug=site-1&version=1&sessionId=sess-existing`,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("studio-shell");
      expect(resolveInitialGenerationSessionId).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
