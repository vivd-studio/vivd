export type StudioIframeFailureSource = "bootstrap" | "response" | "network";

export interface StudioIframeFailure {
  message: string;
  status?: string;
  code?: string;
  retryable?: boolean;
  source: StudioIframeFailureSource;
}

function parseStructuredErrorPayload(
  bodyText: string,
): {
  error: string;
  status?: string;
  code?: string;
  retryable?: boolean;
} | null {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const error =
      typeof parsed.error === "string"
        ? parsed.error.trim()
        : typeof parsed.message === "string"
          ? parsed.message.trim()
          : "";
    if (!error) return null;

    const status =
      typeof parsed.status === "string" ? parsed.status.trim() : undefined;
    const code = typeof parsed.code === "string" ? parsed.code.trim() : undefined;
    const retryable =
      typeof parsed.retryable === "boolean" ? parsed.retryable : undefined;
    return { error, status, code, retryable };
  } catch {
    return null;
  }
}

function normalizeBodyText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || "";
}

function looksLikeStartupPendingMessage(message: string): boolean {
  return (
    message.includes("studio is starting up") ||
    message.includes("please retry shortly")
  );
}

export function isStudioIframeStartupPending(options: {
  pathname?: string | null;
  bodyText?: string | null;
}): boolean {
  const pathname = options.pathname?.trim().toLowerCase() || "";
  const bodyText = normalizeBodyText(options.bodyText);
  const parsed = parseStructuredErrorPayload(options.bodyText?.trim() || "");
  const parsedStatus = parsed?.status?.trim().toLowerCase();
  const parsedError = normalizeBodyText(parsed?.error);
  const parsedCode = parsed?.code?.trim().toLowerCase();

  if (parsed?.retryable || parsedCode === "runtime_starting") {
    return true;
  }

  if (parsedStatus === "starting" || parsedStatus === "installing") {
    return true;
  }

  if (looksLikeStartupPendingMessage(bodyText)) {
    return true;
  }

  if (parsedError && looksLikeStartupPendingMessage(parsedError)) {
    return true;
  }

  if (
    pathname.includes("/vivd-studio/api/bootstrap") &&
    (bodyText.includes("starting") || parsedError.includes("starting"))
  ) {
    return true;
  }

  return false;
}

export function detectStudioIframeFailure(options: {
  pathname?: string | null;
  bodyText?: string | null;
}): StudioIframeFailure | null {
  const pathname = options.pathname?.trim().toLowerCase() || "";
  const bodyText = options.bodyText?.trim() || "";
  const parsed = parseStructuredErrorPayload(bodyText);

  if (isStudioIframeStartupPending(options)) {
    return null;
  }

  if (pathname.includes("/vivd-studio/api/bootstrap")) {
    return {
      message: parsed?.error || bodyText || "Studio bootstrap failed",
      status: parsed?.status,
      code: parsed?.code,
      retryable: parsed?.retryable,
      source: "bootstrap",
    };
  }

  if (parsed?.error && pathname.includes("/vivd-studio/api/")) {
    return {
      message: parsed.error,
      status: parsed.status,
      code: parsed.code,
      retryable: parsed.retryable,
      source: /bootstrap token/i.test(parsed.error) ? "bootstrap" : "response",
    };
  }

  if (parsed?.error) {
    return {
      message: parsed.error,
      status: parsed.status,
      code: parsed.code,
      retryable: parsed.retryable,
      source: /bootstrap token/i.test(parsed.error) ? "bootstrap" : "response",
    };
  }

  if (/^unauthorized$/i.test(bodyText)) {
    return {
      message: bodyText,
      code: "unauthorized",
      retryable: false,
      source: "response",
    };
  }

  if (/studio bootstrap unavailable/i.test(bodyText)) {
    return {
      message: bodyText,
      code: "bootstrap_unconfigured",
      retryable: false,
      source: "bootstrap",
    };
  }

  if (/bootstrap token/i.test(bodyText)) {
    return {
      message: bodyText,
      source: "bootstrap",
    };
  }

  return null;
}

export function describeStudioIframeFailure(
  failure: StudioIframeFailure | null,
): { title: string; description: string } {
  if (!failure) {
    return {
      title: "Studio is taking longer than usual",
      description:
        "The studio machine may still be booting or it might be unresponsive. Try reloading first. If it keeps hanging, hard restart the studio machine.",
    };
  }

  if (failure.code === "bootstrap_unconfigured") {
    return {
      title: "Studio runtime is not configured",
      description:
        "The Studio runtime is missing its secure handoff configuration. Reload first. If it keeps happening, hard restart the studio machine.",
    };
  }

  if (failure.source === "bootstrap") {
    return {
      title: "Studio session could not be restored",
      description:
        "The secure Studio handoff returned an error before the editor could open. Reload first. If it keeps happening, hard restart the studio machine.",
    };
  }

  return {
    title: "We couldn't open Studio",
    description:
      "Vivd loaded an internal error page instead of the editor. Reload first. If that keeps failing, hard restart the studio machine.",
  };
}
