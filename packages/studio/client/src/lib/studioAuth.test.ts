import { afterEach, describe, expect, it } from "vitest";
import {
  getStudioRuntimeBasePath,
  resolveStudioRuntimePath,
  withVivdStudioTokenQuery,
} from "./studioAuth";

const originalWindow = globalThis.window;

function setTestWindow(options: {
  origin?: string;
  pathname: string;
  search?: string;
  hash?: string;
  runtimeBasePath?: string;
}) {
  const win = {
    location: {
      origin: options.origin ?? "http://app.localhost",
      pathname: options.pathname,
      search: options.search ?? "",
      hash: options.hash ?? "",
    },
  } as Window &
    typeof globalThis & {
      __vivdBasePath?: string;
    };

  if (options.runtimeBasePath) {
    win.__vivdBasePath = options.runtimeBasePath;
  }

  globalThis.window = win;
}

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow;
    return;
  }

  delete (globalThis as { window?: Window }).window;
});

describe("studioAuth runtime path helpers", () => {
  it("derives the runtime base path from the mounted studio URL", () => {
    setTestWindow({
      pathname: "/_studio/runtime-123/vivd-studio",
    });

    expect(getStudioRuntimeBasePath()).toBe("/_studio/runtime-123");
    expect(resolveStudioRuntimePath("/")).toBe("/_studio/runtime-123/");
    expect(resolveStudioRuntimePath("/vivd-studio/api/trpc")).toBe(
      "/_studio/runtime-123/vivd-studio/api/trpc",
    );
  });

  it("prefers the injected runtime base path when available", () => {
    setTestWindow({
      pathname: "/vivd-studio",
      runtimeBasePath: "/_studio/runtime-456",
    });

    expect(getStudioRuntimeBasePath()).toBe("/_studio/runtime-456");
    expect(resolveStudioRuntimePath("/vivd-studio/assets/site")).toBe(
      "/_studio/runtime-456/vivd-studio/assets/site",
    );
  });

  it("does not double-prefix already resolved runtime URLs", () => {
    setTestWindow({
      pathname: "/_studio/runtime-123/vivd-studio",
    });

    expect(
      resolveStudioRuntimePath("/_studio/runtime-123/vivd-studio/api/trpc"),
    ).toBe("/_studio/runtime-123/vivd-studio/api/trpc");
  });

  it("adds the studio token to same-origin runtime URLs", () => {
    setTestWindow({
      pathname: "/_studio/runtime-123/vivd-studio",
    });

    expect(
      withVivdStudioTokenQuery("/vivd-studio/api/trpc", "studio-token"),
    ).toBe(
      "/_studio/runtime-123/vivd-studio/api/trpc?vivdStudioToken=studio-token",
    );
  });

  it("leaves cross-origin URLs untouched", () => {
    setTestWindow({
      pathname: "/_studio/runtime-123/vivd-studio",
    });

    expect(
      withVivdStudioTokenQuery("https://example.com/vivd-studio/api/trpc", "studio-token"),
    ).toBe("https://example.com/vivd-studio/api/trpc");
  });
});
