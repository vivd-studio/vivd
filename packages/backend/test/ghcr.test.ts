import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listStudioImagesFromGhcr,
  resolveLatestSemverImageFromGhcr,
} from "../src/services/studioMachines/fly/ghcr";

function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installGhcrMock(options: {
  ownerRepo?: string;
  tags: string[];
  readyTags?: string[];
  manifestStatusByTag?: Record<string, number>;
  headStatusByTag?: Record<string, number>;
}) {
  const ownerRepo = options.ownerRepo || "vivd-studio/vivd-studio";
  const readyTags = new Set(options.readyTags || []);
  const manifestPrefix = `https://ghcr.io/v2/${ownerRepo}/manifests/`;

  const mockFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = toUrlString(input);
      const method = (init?.method || "GET").toUpperCase();

      if (url.startsWith("https://ghcr.io/token")) {
        return jsonResponse({ token: "test-token" });
      }

      if (url === `https://ghcr.io/v2/${ownerRepo}/tags/list`) {
        return jsonResponse({ tags: options.tags });
      }

      if (url.startsWith(manifestPrefix)) {
        const tag = decodeURIComponent(url.slice(manifestPrefix.length));
        const status =
          (method === "HEAD" ? options.headStatusByTag?.[tag] : undefined) ??
          options.manifestStatusByTag?.[tag] ??
          (readyTags.has(tag) ? 200 : 404);
        return new Response(method === "HEAD" ? null : "{}", { status });
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    },
  );

  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GHCR studio image readiness", () => {
  it("lists only tags that have a resolvable manifest", async () => {
    installGhcrMock({
      tags: ["0.4.3", "0.4.2", "dev-0.4.3", "dev-foo"],
      readyTags: ["0.4.2", "dev-foo"],
    });

    const result = await listStudioImagesFromGhcr({
      repository: "ghcr.io/vivd-studio/vivd-studio",
      timeoutMs: 5_000,
      semverLimit: 10,
      devLimit: 10,
    });

    expect(result.images.map((image) => image.tag)).toEqual(["0.4.2", "dev-foo"]);
  });

  it("picks latest ready semver tag, skipping unfinished newest tag", async () => {
    installGhcrMock({
      tags: ["0.5.0", "0.4.9"],
      readyTags: ["0.4.9"],
    });

    const image = await resolveLatestSemverImageFromGhcr({
      repository: "ghcr.io/vivd-studio/vivd-studio",
      timeoutMs: 5_000,
    });

    expect(image).toBe("ghcr.io/vivd-studio/vivd-studio:0.4.9");
  });

  it("throws when semver tags exist but none are manifest-ready", async () => {
    installGhcrMock({
      tags: ["0.5.0", "0.4.9"],
      readyTags: [],
    });

    await expect(
      resolveLatestSemverImageFromGhcr({
        repository: "ghcr.io/vivd-studio/vivd-studio",
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("No ready semver tags found");
  });
});
