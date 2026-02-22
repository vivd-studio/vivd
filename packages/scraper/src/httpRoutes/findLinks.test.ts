import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireMock,
  createPageMock,
  releaseMock,
  isBrowserErrorMock,
  handleCookieBannerMock,
  logMock,
} = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  createPageMock: vi.fn(),
  releaseMock: vi.fn(),
  isBrowserErrorMock: vi.fn(),
  handleCookieBannerMock: vi.fn(),
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

vi.mock("../utils/cookie.js", () => ({
  handleCookieBanner: handleCookieBannerMock,
}));

vi.mock("../utils/logger.js", () => ({
  log: logMock,
}));

import { findLinksRouter } from "./findLinks.js";

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
  const layer = (findLinksRouter as any).stack.find(
    (item: any) => item.route?.path === "/" && item.route.methods.post,
  );
  if (!layer) throw new Error("Could not find findLinks POST route");
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("findLinksRouter", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    acquireMock.mockReset();
    createPageMock.mockReset();
    releaseMock.mockReset();
    isBrowserErrorMock.mockReset();
    handleCookieBannerMock.mockReset();
    logMock.mockReset();

    isBrowserErrorMock.mockReturnValue(false);
    handleCookieBannerMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 400 when texts input is missing/invalid", async () => {
    const handler = getPostHandler();
    const req = { body: { url: "https://example.com", texts: "about" } } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing or invalid 'texts' parameter" });
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it("falls back navigation mode, deduplicates links, and enforces maxLinks", async () => {
    const browser = { id: "browser-1" };
    const frameOne = {
      evaluate: vi.fn().mockResolvedValue([
        { text: "About", url: "https://example.com/about" },
        { text: "Invalid", url: "mailto:test@example.com" },
        { text: "Contact", url: "https://example.com/contact" },
      ]),
    };
    const frameTwo = {
      evaluate: vi.fn().mockResolvedValue([
        { text: "Contact", url: "https://example.com/contact" },
        { text: "External", url: "http://example.org/info" },
      ]),
    };
    const page = {
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error("networkidle2 timeout"))
        .mockResolvedValueOnce(undefined),
      frames: vi.fn(() => [frameOne, frameTwo]),
      close: vi.fn().mockResolvedValue(undefined),
    };

    acquireMock.mockResolvedValue(browser);
    createPageMock.mockResolvedValue(page);

    const handler = getPostHandler();
    const req = {
      body: {
        url: "https://example.com",
        texts: ["About", "Contact"],
        maxLinks: 2,
      },
    } as any;
    const res = makeResponse();

    const pending = handler(req, res);
    await vi.advanceTimersByTimeAsync(500);
    await pending;

    expect(page.goto).toHaveBeenNthCalledWith(1, "https://example.com", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    expect(page.goto).toHaveBeenNthCalledWith(2, "https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    expect(handleCookieBannerMock).toHaveBeenCalledWith(page);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      links: [
        { text: "About", url: "https://example.com/about" },
        { text: "Contact", url: "https://example.com/contact" },
      ],
    });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(browser);
  });
});
