import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRPC_REQUEST_TIMEOUT_MS,
  EXTENDED_TRPC_REQUEST_TIMEOUT_MS,
  LONG_TRPC_REQUEST_TIMEOUT_MS,
  isLikelyTrpcTimeoutError,
  resolveTrpcRequestTimeoutMs,
} from "./trpcTimeouts";

describe("trpcTimeouts", () => {
  it("uses default timeout for unknown procedures", () => {
    const timeoutMs = resolveTrpcRequestTimeoutMs(
      "/vivd-studio/api/trpc/project.publishStatus?batch=1&input=%7B%7D",
    );
    expect(timeoutMs).toBe(DEFAULT_TRPC_REQUEST_TIMEOUT_MS);
  });

  it("uses extended timeout for publish and github sync mutations", () => {
    expect(
      resolveTrpcRequestTimeoutMs("/vivd-studio/api/trpc/project.publish?batch=1&input=%7B%7D"),
    ).toBe(EXTENDED_TRPC_REQUEST_TIMEOUT_MS);
    expect(
      resolveTrpcRequestTimeoutMs(
        "/vivd-studio/api/trpc/project.gitHubPullFastForward?batch=1&input=%7B%7D",
      ),
    ).toBe(EXTENDED_TRPC_REQUEST_TIMEOUT_MS);
  });

  it("uses long timeout for checklist and save mutations", () => {
    expect(
      resolveTrpcRequestTimeoutMs(
        "/vivd-studio/api/trpc/agent.runPrePublishChecklist?batch=1&input=%7B%7D",
      ),
    ).toBe(LONG_TRPC_REQUEST_TIMEOUT_MS);
    expect(
      resolveTrpcRequestTimeoutMs("/vivd-studio/api/trpc/project.gitSave?batch=1&input=%7B%7D"),
    ).toBe(LONG_TRPC_REQUEST_TIMEOUT_MS);
  });

  it("chooses the highest timeout for batched operations", () => {
    const timeoutMs = resolveTrpcRequestTimeoutMs(
      "/vivd-studio/api/trpc/project.publishStatus,project.publish?batch=1&input=%7B%7D",
    );
    expect(timeoutMs).toBe(EXTENDED_TRPC_REQUEST_TIMEOUT_MS);
  });

  it("detects likely timeout and abort errors", () => {
    expect(isLikelyTrpcTimeoutError(new Error("Timed out after 15000ms"))).toBe(true);
    expect(isLikelyTrpcTimeoutError(new Error("AbortError: The operation was aborted."))).toBe(
      true,
    );
    expect(isLikelyTrpcTimeoutError(new Error("Domain is already in use"))).toBe(false);
  });
});
