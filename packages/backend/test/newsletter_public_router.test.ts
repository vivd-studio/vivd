import type { AddressInfo } from "node:net";
import express from "express";
import multer from "multer";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewsletterSubscribeRouter } from "@vivd/plugin-newsletter/backend/http/subscribe";

const { subscribeMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
}));

async function startServer() {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
  });

  app.use(
    "/plugins",
    createNewsletterSubscribeRouter({
      upload,
      service: {
        subscribe: subscribeMock,
      },
    }),
  );

  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    throw new Error("Failed to resolve newsletter public router test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

describe("newsletter public subscribe router", () => {
  let server: Awaited<ReturnType<typeof startServer>> | null = null;

  beforeEach(() => {
    subscribeMock.mockReset();
  });

  afterEach(async () => {
    if (!server) return;
    await server.close();
    server = null;
  });

  it("extracts the source host from origin and redirects browser submits", async () => {
    subscribeMock.mockResolvedValueOnce({
      redirectTarget: "https://site.localhost/thanks",
      result: {
        email: "person@example.com",
        status: "pending",
      },
    });

    server = await startServer();

    const response = await fetch(`${server.baseUrl}/plugins/newsletter/v1/subscribe`, {
      method: "POST",
      headers: {
        Accept: "text/html",
        Origin: "https://site.localhost",
        Referer: "https://site.localhost/signup?utm_source=launch",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({
        token: "newsletter-token",
        email: "person@example.com",
      }).toString(),
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://site.localhost/thanks");
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "newsletter-token",
        email: "person@example.com",
        sourceHost: "site.localhost",
        origin: "https://site.localhost",
        referer: "https://site.localhost/signup?utm_source=launch",
      }),
    );
  });

  it("returns JSON for API clients", async () => {
    subscribeMock.mockResolvedValueOnce({
      redirectTarget: null,
      result: {
        email: "person@example.com",
        status: "pending",
      },
    });

    server = await startServer();

    const response = await fetch(`${server.baseUrl}/plugins/newsletter/v1/subscribe`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "newsletter-token",
        email: "person@example.com",
        name: "Person Example",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        email: "person@example.com",
        status: "pending",
      },
    });
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "newsletter-token",
        email: "person@example.com",
        name: "Person Example",
        sourceHost: null,
        origin: null,
        referer: null,
      }),
    );
  });

  it("short-circuits honeypot submissions without touching the service", async () => {
    server = await startServer();

    const response = await fetch(`${server.baseUrl}/plugins/newsletter/v1/subscribe`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({
        token: "newsletter-token",
        email: "person@example.com",
        _honeypot: "spam",
      }).toString(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        email: "person@example.com",
        status: "pending",
      },
    });
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("returns JSON validation errors for missing required fields", async () => {
    server = await startServer();

    const response = await fetch(`${server.baseUrl}/plugins/newsletter/v1/subscribe`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "person@example.com",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "missing_token",
        message: "token is required",
      },
    });
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});
