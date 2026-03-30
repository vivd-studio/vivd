import type http from "node:http";
import type net from "node:net";
import { describe, expect, it, vi } from "vitest";

import {
  handleStudioPreviewUpgrade,
  shouldHandleStudioPreviewUpgrade,
} from "./devServerUpgrade";

function createSocket() {
  return {
    destroyed: false,
    write: vi.fn(),
    destroy: vi.fn(function (this: { destroyed: boolean }) {
      this.destroyed = true;
    }),
  } as unknown as net.Socket;
}

describe("shouldHandleStudioPreviewUpgrade", () => {
  it("accepts preview-root upgrade paths", () => {
    expect(shouldHandleStudioPreviewUpgrade("/")).toBe(true);
    expect(shouldHandleStudioPreviewUpgrade("/products/tea")).toBe(true);
  });

  it("rejects studio shell and api paths", () => {
    expect(shouldHandleStudioPreviewUpgrade("/vivd-studio")).toBe(false);
    expect(shouldHandleStudioPreviewUpgrade("/vivd-studio/api/trpc")).toBe(false);
    expect(shouldHandleStudioPreviewUpgrade("/trpc")).toBe(false);
    expect(shouldHandleStudioPreviewUpgrade("/preview")).toBe(false);
  });
});

describe("handleStudioPreviewUpgrade", () => {
  it("rejects unauthorized upgrade requests", async () => {
    const socket = createSocket();
    const proxy = { upgrade: vi.fn() };

    const handled = await handleStudioPreviewUpgrade({
      req: {
        url: "/?token=vite",
        headers: {},
        method: "GET",
      } as http.IncomingMessage,
      socket,
      head: Buffer.alloc(0),
      env: { STUDIO_ACCESS_TOKEN: "studio-token" } as NodeJS.ProcessEnv,
      workspace: {
        isInitialized: () => true,
        getProjectPath: () => "/tmp/project",
      },
      proxy,
    });

    expect(handled).toBe(true);
    expect(proxy.upgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining("401 Unauthorized"),
    );
  });

  it("proxies authorized preview websocket upgrades to the dev server", async () => {
    const socket = createSocket();
    const proxy = { upgrade: vi.fn() };
    const getOrStartDevServer = vi.fn().mockResolvedValue({
      url: null,
      status: "starting",
    });

    const req = {
      url: "/?token=vite-hmr",
      headers: {
        cookie: "vivd_studio_token=studio-token",
      },
      method: "GET",
    } as http.IncomingMessage & { vivdDevPreviewTarget?: string };

    const handled = await handleStudioPreviewUpgrade({
      req,
      socket,
      head: Buffer.from("head"),
      env: { STUDIO_ACCESS_TOKEN: "studio-token" } as NodeJS.ProcessEnv,
      workspace: {
        isInitialized: () => true,
        getProjectPath: () => "/tmp/project",
      },
      proxy,
      detectProjectTypeImpl: () => ({
        mode: "devserver",
        devCommand: "npm run dev",
        packageManager: "npm",
        framework: "astro",
      }),
      devServerServiceImpl: {
        hasServer: () => false,
        getOrStartDevServer,
        getDevServerUrl: () => "http://127.0.0.1:4321",
        getDevServerStatus: () => "ready",
      },
    });

    expect(handled).toBe(true);
    expect(getOrStartDevServer).toHaveBeenCalledWith("/tmp/project", "/");
    expect(req.vivdDevPreviewTarget).toBe("http://127.0.0.1:4321");
    expect(proxy.upgrade).toHaveBeenCalledWith(req, socket, Buffer.from("head"));
  });

  it("returns 503 while the dev server is still unavailable", async () => {
    const socket = createSocket();
    const proxy = { upgrade: vi.fn() };

    const handled = await handleStudioPreviewUpgrade({
      req: {
        url: "/?token=vite-hmr",
        headers: {
          cookie: "vivd_studio_token=studio-token",
        },
        method: "GET",
      } as http.IncomingMessage,
      socket,
      head: Buffer.alloc(0),
      env: { STUDIO_ACCESS_TOKEN: "studio-token" } as NodeJS.ProcessEnv,
      workspace: {
        isInitialized: () => true,
        getProjectPath: () => "/tmp/project",
      },
      proxy,
      detectProjectTypeImpl: () => ({
        mode: "devserver",
        devCommand: "npm run dev",
        packageManager: "npm",
        framework: "astro",
      }),
      devServerServiceImpl: {
        hasServer: () => true,
        getOrStartDevServer: vi.fn().mockResolvedValue({
          url: null,
          status: "starting",
        }),
        getDevServerUrl: () => null,
        getDevServerStatus: () => "starting",
      },
    });

    expect(handled).toBe(true);
    expect(proxy.upgrade).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith(
      expect.stringContaining('"status":"starting"'),
    );
  });

  it("ignores non-preview upgrade paths", async () => {
    const socket = createSocket();
    const proxy = { upgrade: vi.fn() };

    const handled = await handleStudioPreviewUpgrade({
      req: {
        url: "/vivd-studio/api/trpc",
        headers: {},
        method: "GET",
      } as http.IncomingMessage,
      socket,
      head: Buffer.alloc(0),
      env: { STUDIO_ACCESS_TOKEN: "studio-token" } as NodeJS.ProcessEnv,
      workspace: {
        isInitialized: () => true,
        getProjectPath: () => "/tmp/project",
      },
      proxy,
    });

    expect(handled).toBe(false);
    expect(proxy.upgrade).not.toHaveBeenCalled();
    expect(socket.write).not.toHaveBeenCalled();
  });
});
