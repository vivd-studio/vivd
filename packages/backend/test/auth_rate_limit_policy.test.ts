import { describe, expect, it } from "vitest";
import { classifyAuthRateLimitAction } from "../src/services/system/AuthRateLimitPolicy";

describe("classifyAuthRateLimitAction", () => {
  it("classifies sign-in requests separately", () => {
    expect(
      classifyAuthRateLimitAction("/vivd-studio/api/auth/sign-in/email"),
    ).toBe("auth_sign_in");
  });

  it("classifies sign-up requests separately", () => {
    expect(
      classifyAuthRateLimitAction("/vivd-studio/api/auth/sign-up/email"),
    ).toBe("auth_sign_up");
  });

  it("classifies password-reset flows together", () => {
    expect(
      classifyAuthRateLimitAction(
        "/vivd-studio/api/auth/request-password-reset",
      ),
    ).toBe("auth_password_reset");
    expect(
      classifyAuthRateLimitAction("/vivd-studio/api/auth/reset-password"),
    ).toBe("auth_password_reset");
  });

  it("classifies verification flows separately", () => {
    expect(
      classifyAuthRateLimitAction(
        "/vivd-studio/api/auth/send-verification-email",
      ),
    ).toBe("auth_verification");
    expect(
      classifyAuthRateLimitAction("/vivd-studio/api/auth/verify-email"),
    ).toBe("auth_verification");
  });

  it("falls back to generic auth mutation for other writes", () => {
    expect(
      classifyAuthRateLimitAction("/vivd-studio/api/auth/change-password"),
    ).toBe("auth_mutation");
    expect(
      classifyAuthRateLimitAction("/vivd-studio/api/auth/sign-out"),
    ).toBe("auth_mutation");
  });
});
