import { describe, expect, it } from "vitest";

import { resolveOpencodeServerReadyTimeoutMs } from "./serverManager.js";

describe("resolveOpencodeServerReadyTimeoutMs", () => {
  it("defaults to 120 seconds", () => {
    expect(resolveOpencodeServerReadyTimeoutMs({})).toBe(120_000);
  });

  it("uses an explicit timeout override", () => {
    expect(
      resolveOpencodeServerReadyTimeoutMs({
        OPENCODE_SERVER_READY_TIMEOUT_MS: "180000",
      }),
    ).toBe(180_000);
  });

  it("falls back for invalid overrides", () => {
    expect(
      resolveOpencodeServerReadyTimeoutMs({
        OPENCODE_SERVER_READY_TIMEOUT_MS: "invalid",
      }),
    ).toBe(120_000);
    expect(
      resolveOpencodeServerReadyTimeoutMs({
        OPENCODE_SERVER_READY_TIMEOUT_MS: "500",
      }),
    ).toBe(120_000);
  });
});
