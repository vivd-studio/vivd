import { afterEach, describe, expect, it } from "vitest";
import {
  getStudioOpencodeImageAiMaxParallel,
  getStudioOpencodeOrphanedBusyGraceMs,
  getStudioOpencodeSoftContextLimitTokens,
  getStudioRuntimeConfig,
} from "./config.js";

const ORIGINAL_ENV_VALUE = process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
const ORIGINAL_ORPHANED_GRACE_ENV_VALUE =
  process.env.STUDIO_OPENCODE_ORPHANED_BUSY_GRACE_MS;
const ORIGINAL_IMAGE_AI_MAX_PARALLEL_ENV_VALUE =
  process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL;

afterEach(() => {
  if (typeof ORIGINAL_ENV_VALUE === "string") {
    process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS = ORIGINAL_ENV_VALUE;
  } else {
    delete process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  }

  if (typeof ORIGINAL_ORPHANED_GRACE_ENV_VALUE === "string") {
    process.env.STUDIO_OPENCODE_ORPHANED_BUSY_GRACE_MS =
      ORIGINAL_ORPHANED_GRACE_ENV_VALUE;
  } else {
    delete process.env.STUDIO_OPENCODE_ORPHANED_BUSY_GRACE_MS;
  }

  if (typeof ORIGINAL_IMAGE_AI_MAX_PARALLEL_ENV_VALUE === "string") {
    process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL =
      ORIGINAL_IMAGE_AI_MAX_PARALLEL_ENV_VALUE;
  } else {
    delete process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL;
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

  it("uses the default orphaned busy grace when env is unset", () => {
    delete process.env.STUDIO_OPENCODE_ORPHANED_BUSY_GRACE_MS;

    expect(getStudioOpencodeOrphanedBusyGraceMs()).toBe(20 * 60 * 1000);
  });

  it("uses the env override for orphaned busy grace when it is at least one minute", () => {
    process.env.STUDIO_OPENCODE_ORPHANED_BUSY_GRACE_MS = "1800000";

    expect(getStudioOpencodeOrphanedBusyGraceMs()).toBe(1_800_000);
  });

  it("falls back to the default orphaned busy grace when env is invalid", () => {
    process.env.STUDIO_OPENCODE_ORPHANED_BUSY_GRACE_MS = "5000";

    expect(getStudioOpencodeOrphanedBusyGraceMs()).toBe(20 * 60 * 1000);
  });

  it("uses the default image-ai parallel limit when env is unset", () => {
    delete process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL;

    expect(getStudioOpencodeImageAiMaxParallel()).toBe(3);
  });

  it("uses the env override for image-ai parallel limit when it is positive", () => {
    process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL = "4";

    expect(getStudioOpencodeImageAiMaxParallel()).toBe(4);
  });

  it("falls back to the default image-ai parallel limit when env is invalid", () => {
    process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL = "0";

    expect(getStudioOpencodeImageAiMaxParallel()).toBe(3);
  });
});
