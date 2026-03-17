import { describe, expect, it } from "vitest";
import { sanitizeSessionError } from "./errorPolicy";

describe("opencodeChat errorPolicy", () => {
  it("redacts upstream provider credit errors", () => {
    const error = sanitizeSessionError({
      type: "task",
      message:
        "This request requires more credits, or fewer max tokens. You requested up to 32000 tokens, but can only afford 25344. To increase, visit https://openrouter.ai/settings/credits",
    });

    expect(error.type).toBe("provider_limit");
    expect(error.message.toLowerCase()).not.toContain("openrouter.ai");
    expect(error.message.toLowerCase()).not.toContain("32000");
  });

  it("maps retry to a safe temporary message", () => {
    const error = sanitizeSessionError({
      type: "retry",
      message: "upstream retry in 10s",
      attempt: 2,
    });

    expect(error.type).toBe("retry");
    expect(error.message).toContain("temporary issue");
    expect(error.attempt).toBe(2);
  });

  it("falls back to a generic safe task error", () => {
    const error = sanitizeSessionError({
      type: "task",
      message: 'Failed to prompt session: {"debug":"internal stack"}',
    });

    expect(error.type).toBe("task");
    expect(error.message).toBe(
      "Something went wrong while running this task. Please try again.",
    );
  });
});
