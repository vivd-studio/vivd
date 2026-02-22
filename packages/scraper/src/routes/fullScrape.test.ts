import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  acquireMock,
  createPageMock,
  releaseMock,
  isBrowserErrorMock,
  scrapePageMock,
  takeMainPageScreenshotMock,
  takeHeaderScreenshotMock,
  extractNavigationTextsMock,
  prioritizeNavigationLinksMock,
  findLinksMatchingTextsMock,
  logMock,
  sharpMock,
} = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  createPageMock: vi.fn(),
  releaseMock: vi.fn(),
  isBrowserErrorMock: vi.fn(),
  scrapePageMock: vi.fn(),
  takeMainPageScreenshotMock: vi.fn(),
  takeHeaderScreenshotMock: vi.fn(),
  extractNavigationTextsMock: vi.fn(),
  prioritizeNavigationLinksMock: vi.fn(),
  findLinksMatchingTextsMock: vi.fn(),
  logMock: vi.fn(),
  sharpMock: vi.fn(),
}));

vi.mock("../services/browser.js", () => ({
  browserPool: {
    acquire: acquireMock,
    createPage: createPageMock,
    release: releaseMock,
  },
  isBrowserError: isBrowserErrorMock,
}));

vi.mock("../services/scraper.js", () => ({
  scrapePage: scrapePageMock,
}));

vi.mock("../services/screenshot.js", () => ({
  takeMainPageScreenshot: takeMainPageScreenshotMock,
  takeHeaderScreenshot: takeHeaderScreenshotMock,
}));

vi.mock("../services/openrouter.js", () => ({
  extractNavigationTextsFromHeaderScreenshot: extractNavigationTextsMock,
  prioritizeNavigationLinks: prioritizeNavigationLinksMock,
}));

vi.mock("../services/links.js", () => ({
  findLinksMatchingTexts: findLinksMatchingTextsMock,
}));

vi.mock("../utils/logger.js", () => ({
  log: logMock,
}));

vi.mock("sharp", () => ({
  default: sharpMock,
}));

import { fullScrapeRouter } from "./fullScrape.js";

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
  const layer = (fullScrapeRouter as any).stack.find(
    (item: any) => item.route?.path === "/" && item.route.methods.post,
  );
  if (!layer) throw new Error("Could not find fullScrape POST route");
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("fullScrapeRouter", () => {
  beforeEach(() => {
    acquireMock.mockReset();
    createPageMock.mockReset();
    releaseMock.mockReset();
    isBrowserErrorMock.mockReset();
    scrapePageMock.mockReset();
    takeMainPageScreenshotMock.mockReset();
    takeHeaderScreenshotMock.mockReset();
    extractNavigationTextsMock.mockReset();
    prioritizeNavigationLinksMock.mockReset();
    findLinksMatchingTextsMock.mockReset();
    logMock.mockReset();
    sharpMock.mockReset();
    delete process.env.OPENROUTER_API_KEY;

    sharpMock.mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: 300, height: 200 }),
    });
    isBrowserErrorMock.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("returns 400 when url input is missing", async () => {
    const handler = getPostHandler();
    const req = { body: {} } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Missing or invalid 'url' parameter" });
    expect(acquireMock).not.toHaveBeenCalled();
  });

  it("returns 422 with error context when main-page scraping fails", async () => {
    const page = { close: vi.fn().mockResolvedValue(undefined) };
    const browser = { id: "browser-1" };
    acquireMock.mockResolvedValue(browser);
    createPageMock.mockResolvedValue(page);
    scrapePageMock.mockResolvedValue({
      text: "Blocked content",
      images: [],
      error: {
        type: "blocked",
        message: "Access denied",
      },
    });
    takeMainPageScreenshotMock.mockResolvedValue("main-screenshot");
    takeHeaderScreenshotMock.mockResolvedValue("header-screenshot");

    const handler = getPostHandler();
    const req = { body: { url: "https://example.com" } } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      error: "Access denied",
      errorType: "blocked",
      screenshot: "main-screenshot",
      headerScreenshot: "header-screenshot",
    });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(browser);
  });

  it("scrapes prioritized subpages and returns aggregated output", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const page = { close: vi.fn().mockResolvedValue(undefined) };
    const browser = { id: "browser-2" };
    acquireMock.mockResolvedValue(browser);
    createPageMock.mockResolvedValue(page);
    takeMainPageScreenshotMock.mockResolvedValue("main-shot");
    takeHeaderScreenshotMock.mockResolvedValue("header-shot");
    extractNavigationTextsMock.mockResolvedValue(["About", "Contact"]);
    findLinksMatchingTextsMock.mockResolvedValue([
      "https://example.com/about",
      "https://example.com/contact",
    ]);
    prioritizeNavigationLinksMock.mockResolvedValue([
      "https://example.com/about",
      "https://example.com/contact",
    ]);

    const encodedImage = Buffer.from("image-data").toString("base64");
    scrapePageMock.mockImplementation(
      async (_page: unknown, url: string, isMainPage: boolean) => {
        if (isMainPage) {
          return {
            text: "Home text",
            images: [{ data: encodedImage, mimeType: "image/png", filename: "hero.png" }],
            error: null,
          };
        }
        return {
          text: `Subpage text for ${url}`,
          images: [],
          error: null,
        };
      },
    );

    const handler = getPostHandler();
    const req = { body: { url: "https://example.com" } } as any;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.websiteText).toContain("## Page: Home");
    expect(res.body.websiteText).toContain("## Page: https://example.com/about");
    expect(res.body.websiteText).toContain("## Page: https://example.com/contact");
    expect(Array.isArray(res.body.images)).toBe(true);
    expect(res.body.images.length).toBeGreaterThan(0);
    expect(releaseMock).toHaveBeenCalledWith(browser);
  });
});
