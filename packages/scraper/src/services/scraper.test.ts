import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  logMock,
  handleCookieBannerMock,
  autoScrollMock,
  cleanTextMock,
  downloadImageMock,
  isBlockedDomainMock,
  sanitizeFilenameMock,
  validatePageContentMock,
  quickBlockCheckMock,
} = vi.hoisted(() => ({
  logMock: vi.fn(),
  handleCookieBannerMock: vi.fn(),
  autoScrollMock: vi.fn(),
  cleanTextMock: vi.fn(),
  downloadImageMock: vi.fn(),
  isBlockedDomainMock: vi.fn(),
  sanitizeFilenameMock: vi.fn(),
  validatePageContentMock: vi.fn(),
  quickBlockCheckMock: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  log: logMock,
}));

vi.mock("../utils/cookie.js", () => ({
  handleCookieBanner: handleCookieBannerMock,
  autoScroll: autoScrollMock,
  cleanText: cleanTextMock,
}));

vi.mock("../utils/images.js", () => ({
  downloadImage: downloadImageMock,
  isBlockedDomain: isBlockedDomainMock,
  sanitizeFilename: sanitizeFilenameMock,
}));

vi.mock("../utils/pageValidation.js", () => ({
  validatePageContent: validatePageContentMock,
  quickBlockCheck: quickBlockCheckMock,
}));

import { scrapePage } from "./scraper.js";

function makeClient() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };
}

describe("scrapePage", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    logMock.mockReset();
    handleCookieBannerMock.mockReset();
    autoScrollMock.mockReset();
    cleanTextMock.mockReset();
    downloadImageMock.mockReset();
    isBlockedDomainMock.mockReset();
    sanitizeFilenameMock.mockReset();
    validatePageContentMock.mockReset();
    quickBlockCheckMock.mockReset();

    handleCookieBannerMock.mockResolvedValue(undefined);
    autoScrollMock.mockResolvedValue(undefined);
    cleanTextMock.mockImplementation((text: string) => text.trim());
    downloadImageMock.mockResolvedValue(null);
    isBlockedDomainMock.mockReturnValue(false);
    sanitizeFilenameMock.mockReturnValue("image.jpg");
    validatePageContentMock.mockReturnValue({ isValid: true, error: undefined });
    quickBlockCheckMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns navigation_failed when page navigation cannot complete", async () => {
    const client = makeClient();
    const page = {
      createCDPSession: vi.fn().mockResolvedValue(client),
      on: vi.fn(),
      off: vi.fn(),
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error("networkidle timeout"))
        .mockRejectedValueOnce(new Error("domcontentloaded timeout")),
    };

    const result = await scrapePage(page as any, "https://example.com", true);

    expect(result).toEqual({
      text: "",
      images: [],
      error: {
        type: "navigation_failed",
        message: "Failed to load the website: domcontentloaded timeout",
      },
    });
    expect(client.detach).toHaveBeenCalledTimes(1);
  });

  it("propagates validation errors while still returning scraped content", async () => {
    const client = makeClient();
    const page = {
      createCDPSession: vi.fn().mockResolvedValue(client),
      on: vi.fn(),
      off: vi.fn(),
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
      }),
      content: vi.fn().mockResolvedValue("<html><body>Test</body></html>"),
      frames: vi.fn(() => [
        {
          evaluate: vi
            .fn()
            .mockResolvedValueOnce("Some useful text")
            .mockResolvedValueOnce([]),
        },
      ]),
    };
    validatePageContentMock.mockReturnValueOnce({
      isValid: false,
      error: {
        type: "bot_detection",
        message: "Challenge page detected",
      },
    });

    const pending = scrapePage(page as any, "https://example.com", false);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result).toMatchObject({
      text: "Some useful text",
      images: [],
      error: {
        type: "bot_detection",
        message: "Challenge page detected",
      },
    });
    expect(client.detach).toHaveBeenCalledTimes(1);
  });
});
