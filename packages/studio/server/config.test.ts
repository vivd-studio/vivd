import { afterEach, describe, expect, it } from "vitest";
import {
  getStudioOpencodeSoftContextLimitTokens,
  getStudioRuntimeConfig,
} from "./config.js";

const ORIGINAL_ENV_VALUE = process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;

afterEach(() => {
  if (typeof ORIGINAL_ENV_VALUE === "string") {
    process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS = ORIGINAL_ENV_VALUE;
  } else {
    delete process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  }
});

describe("studio config", () => {
  it("uses the default soft context limit when env is unset", () => {
    delete process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;

    expect(getStudioOpencodeSoftContextLimitTokens()).toBe(200_000);
    expect(getStudioRuntimeConfig()).toEqual({
      softContextLimitTokens: 200_000,
    });
  });

  it("uses the env override when it is a positive integer", () => {
    process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS = "275000";

    expect(getStudioOpencodeSoftContextLimitTokens()).toBe(275_000);
  });

  it("falls back to the default limit when env is invalid", () => {
    process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS = "nope";

    expect(getStudioOpencodeSoftContextLimitTokens()).toBe(200_000);
  });
});
