import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireMock,
  createPageMock,
  releaseMock,
  isBrowserErrorMock,
  capturePreviewLogsMock,
  logMock,
} = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  createPageMock: vi.fn(),
  releaseMock: vi.fn(),
  isBrowserErrorMock: vi.fn(),
  capturePreviewLogsMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock("../services/browser.js", () => ({
  browserPool: {
    acquire: acquireMock,
    createPage: createPageMock,
    release: releaseMock,
  },
  isBrowserError: isBrowserErrorMock,
}));

vi.mock("../services/previewLogs.js", () => ({
  capturePreviewLogs: capturePreviewLogsMock,
}));

vi.mock("../utils/logger.js", () => ({
  log: logMock,
}));

import { previewLogsRouter } from "./previewLogs.js";

type TestResponse = {
  statusCode: number;
  body: any;
  status: (code: number) => TestResponse;
  json: (payload: unknown) => TestResponse;
};

function makeResponse(): TestResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function getPostHandler() {
  const layer = (previewLogsRouter as any).stack.find(
    (item: any) => item.route?.path === "/" && item.route.methods.post,
  );
  if (!layer) throw new Error("Could not find preview-logs POST route");
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("previewLogsRouter", () => {
  beforeEach(() => {
    acquireMock.mockReset();
    createPageMock.mockReset();
    releaseMock.mockReset();
    isBrowserErrorMock.mockReset();
    capturePreviewLogsMock.mockReset();
    logMock.mockReset();

    isBrowserErrorMock.mockReturnValue(false);
  });

  it("returns 400 when url input is missing/invalid", async () => {
    const handler = getPostHandler();
    const req = { body: {} } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing or invalid 'url' input" });
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it("captures preview logs with forwarded filters and headers", async () => {
    const browser = { id: "browser-preview-logs" };
    const page = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    acquireMock.mockResolvedValue(browser);
    createPageMock.mockResolvedValue(page);
    capturePreviewLogsMock.mockResolvedValue({
      url: "https://preview.example.test/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      entries: [
        {
          type: "error",
          text: "Hydration failed",
          timestamp: "2026-04-09T10:00:00.000Z",
          textTruncated: false,
        },
      ],
      summary: {
        observed: 4,
        matched: 1,
        returned: 1,
        dropped: 0,
        truncatedMessages: 0,
      },
    });

    const handler = getPostHandler();
    const req = {
      body: {
        url: "https://preview.example.test/pricing",
        waitMs: 1200,
        limit: 10,
        level: "warn",
        contains: "hydrate",
        headers: {
          "x-vivd-studio-token": "studio-token",
          "x-vivd-organization-id": "org-1",
        },
      },
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(capturePreviewLogsMock).toHaveBeenCalledWith(page, {
      url: "https://preview.example.test/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      headers: {
        "x-vivd-studio-token": "studio-token",
        "x-vivd-organization-id": "org-1",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      url: "https://preview.example.test/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      entries: [
        {
          type: "error",
          text: "Hydration failed",
          timestamp: "2026-04-09T10:00:00.000Z",
          textTruncated: false,
        },
      ],
      summary: {
        observed: 4,
        matched: 1,
        returned: 1,
        dropped: 0,
        truncatedMessages: 0,
      },
    });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(browser);
  });
});
