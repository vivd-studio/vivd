export const STUDIO_BOOTSTRAP_STATUS_PATH =
  "/vivd-studio/api/bootstrap-status";

export type StudioBootstrapStatusState = "starting" | "ready" | "failed";

export type StudioBootstrapStatusCode =
  | "runtime_starting"
  | "bootstrap_unconfigured"
  | "missing_bootstrap_token"
  | "missing_bootstrap_target"
  | "invalid_bootstrap_token"
  | "invalid_bootstrap_target"
  | "unauthorized"
  | "internal_error";

export type StudioBootstrapStatusPayload = {
  status: StudioBootstrapStatusState;
  code?: StudioBootstrapStatusCode;
  retryable: boolean;
  canBootstrap: boolean;
  message: string;
};

const BOOTSTRAP_STATUS_CODES = new Set<string>([
  "runtime_starting",
  "bootstrap_unconfigured",
  "missing_bootstrap_token",
  "missing_bootstrap_target",
  "invalid_bootstrap_token",
  "invalid_bootstrap_target",
  "unauthorized",
  "internal_error",
]);

export function isStudioBootstrapStatusCode(
  value: unknown,
): value is StudioBootstrapStatusCode {
  return typeof value === "string" && BOOTSTRAP_STATUS_CODES.has(value);
}

export function isStudioBootstrapStatusPayload(
  value: unknown,
): value is StudioBootstrapStatusPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const payload = value as Partial<StudioBootstrapStatusPayload>;
  return (
    (payload.status === "starting" ||
      payload.status === "ready" ||
      payload.status === "failed") &&
    (typeof payload.code === "undefined" ||
      isStudioBootstrapStatusCode(payload.code)) &&
    (payload.status === "ready" || isStudioBootstrapStatusCode(payload.code)) &&
    typeof payload.retryable === "boolean" &&
    typeof payload.canBootstrap === "boolean" &&
    typeof payload.message === "string"
  );
}

export function createStudioBootstrapStatusPayload(
  payload: StudioBootstrapStatusPayload,
): StudioBootstrapStatusPayload {
  return payload;
}
