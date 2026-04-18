import type { ControlPlaneRateLimitAction } from "./ControlPlaneRateLimitService";

export function classifyAuthRateLimitAction(
  requestPath: string,
): ControlPlaneRateLimitAction {
  const normalized = requestPath.trim().toLowerCase();

  if (normalized.includes("/sign-in")) {
    return "auth_sign_in";
  }

  if (normalized.includes("/sign-up")) {
    return "auth_sign_up";
  }

  if (
    normalized.includes("/request-password-reset") ||
    normalized.includes("/reset-password")
  ) {
    return "auth_password_reset";
  }

  if (
    normalized.includes("/send-verification-email") ||
    normalized.includes("/verify-email")
  ) {
    return "auth_verification";
  }

  return "auth_mutation";
}
