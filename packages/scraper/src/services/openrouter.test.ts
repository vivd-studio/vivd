import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logMock } = vi.hoisted(() => ({
  logMock: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  log: logMock,
}));

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "NAVIGATION_MODEL",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv(): void {
  for (const [key, value] of originalEnv) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

describe("openrouter service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    logMock.mockReset();
    globalThis.fetch = vi.fn() as any;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.NAVIGATION_MODEL;
  });

  afterEach(() => {
    restoreEnv();
    globalThis.fetch = originalFetch;
  });

  it("returns empty nav texts and skips network when API key is missing", async () => {
    const { extractNavigationTextsFromHeaderScreenshot } = await import("./openrouter.js");

    const result = await extractNavigationTextsFromHeaderScreenshot("abc123");

    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("parses navigation texts from OpenRouter JSON responses", async () => {
    process.env.OPENROUTER_API_KEY = "key-1";
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"links":["Home","Services",123]}',
            },
          },
        ],
      }),
    });
    const { extractNavigationTextsFromHeaderScreenshot } = await import("./openrouter.js");

    const result = await extractNavigationTextsFromHeaderScreenshot("abc123");

    expect(result).toEqual(["Home", "Services"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer key-1",
        }),
      }),
    );
  });

  it("prioritizes links via model output and caps to maxPages", async () => {
    process.env.OPENROUTER_API_KEY = "key-2";
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"urls":["https://example.com/contact","https://example.com/about","https://example.com/team"]}',
            },
          },
        ],
      }),
    });
    const { prioritizeNavigationLinks } = await import("./openrouter.js");

    const result = await prioritizeNavigationLinks(
      [
        { text: "About", url: "https://example.com/about" },
        { text: "Contact", url: "https://example.com/contact" },
        { text: "Team", url: "https://example.com/team" },
      ],
      2,
    );

    expect(result).toEqual([
      "https://example.com/contact",
      "https://example.com/about",
    ]);
  });

  it("falls back to first links when OpenRouter request fails", async () => {
    process.env.OPENROUTER_API_KEY = "key-3";
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "upstream down",
    });
    const { prioritizeNavigationLinks } = await import("./openrouter.js");
    const links = [
      { text: "About", url: "https://example.com/about" },
      { text: "Contact", url: "https://example.com/contact" },
      { text: "Services", url: "https://example.com/services" },
    ];

    const result = await prioritizeNavigationLinks(links, 2);

    expect(result).toEqual([
      "https://example.com/about",
      "https://example.com/contact",
    ]);
    expect(logMock).toHaveBeenCalledWith(
      expect.stringContaining("OpenRouter link prioritization failed"),
    );
  });
});
