import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireMock,
  createPageMock,
  releaseMock,
  isBrowserErrorMock,
  captureReferenceScreenshotMock,
  logMock,
} = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  createPageMock: vi.fn(),
  releaseMock: vi.fn(),
  isBrowserErrorMock: vi.fn(),
  captureReferenceScreenshotMock: vi.fn(),
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

vi.mock("../services/screenshot.js", () => ({
  captureReferenceScreenshot: captureReferenceScreenshotMock,
}));

vi.mock("../utils/logger.js", () => ({
  log: logMock,
}));

import { screenshotRouter } from "./screenshot.js";

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
  const layer = (screenshotRouter as any).stack.find(
    (item: any) => item.route?.path === "/" && item.route.methods.post,
  );
  if (!layer) throw new Error("Could not find screenshot POST route");
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("screenshotRouter", () => {
  beforeEach(() => {
    acquireMock.mockReset();
    createPageMock.mockReset();
    releaseMock.mockReset();
    isBrowserErrorMock.mockReset();
    captureReferenceScreenshotMock.mockReset();
    logMock.mockReset();

    isBrowserErrorMock.mockReturnValue(false);
  });

  it("returns 400 when urls input is missing/invalid", async () => {
    const handler = getPostHandler();
    const req = { body: { urls: [] } } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing or invalid 'urls' array" });
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it("caps captures by maxScreenshots and omits failed captures", async () => {
    const browser = { id: "browser-1" };
    const page = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    acquireMock.mockResolvedValue(browser);
    createPageMock.mockResolvedValue(page);
    captureReferenceScreenshotMock
      .mockResolvedValueOnce({
        url: "https://example.com/a",
        data: "base64-a",
        filename: "capture-0.png",
      })
      .mockResolvedValueOnce(null);

    const handler = getPostHandler();
    const req = {
      body: {
        urls: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
        ],
        maxScreenshots: 2,
      },
    } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(captureReferenceScreenshotMock).toHaveBeenCalledTimes(2);
    expect(captureReferenceScreenshotMock).toHaveBeenNthCalledWith(
      1,
      page,
      "https://example.com/a",
      0,
    );
    expect(captureReferenceScreenshotMock).toHaveBeenNthCalledWith(
      2,
      page,
      "https://example.com/b",
      1,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      screenshots: [
        {
          url: "https://example.com/a",
          data: "base64-a",
          filename: "capture-0.png",
        },
      ],
    });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(browser);
  });

  it("marks browser unhealthy on capture errors classified as browser failures", async () => {
    const browser = { id: "browser-2" };
    const page = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const error = new Error("browser crashed");
    acquireMock.mockResolvedValue(browser);
    createPageMock.mockResolvedValue(page);
    captureReferenceScreenshotMock.mockRejectedValueOnce(error);
    isBrowserErrorMock.mockReturnValueOnce(true);

    const handler = getPostHandler();
    const req = { body: { urls: ["https://example.com/a"] } } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "browser crashed" });
    expect(releaseMock).toHaveBeenCalledWith(browser, true);
  });
});
