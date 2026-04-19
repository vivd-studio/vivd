export type StudioIframeFailureSource = "bootstrap" | "response" | "network";

export interface StudioIframeFailure {
  message: string;
  status?: string;
  source: StudioIframeFailureSource;
}

function parseStructuredErrorPayload(
  bodyText: string,
): { error: string; status?: string } | null {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const error =
      typeof parsed.error === "string" ? parsed.error.trim() : "";
    if (!error) return null;

    const status =
      typeof parsed.status === "string" ? parsed.status.trim() : undefined;
    return { error, status };
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
    message.includes("please retry shortly") ||
    message.includes("studio bootstrap unavailable")
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
      source: "bootstrap",
    };
  }

  if (parsed?.error && pathname.includes("/vivd-studio/api/")) {
    return {
      message: parsed.error,
      status: parsed.status,
      source: /bootstrap token/i.test(parsed.error) ? "bootstrap" : "response",
    };
  }

  if (parsed?.error) {
    return {
      message: parsed.error,
      status: parsed.status,
      source: /bootstrap token/i.test(parsed.error) ? "bootstrap" : "response",
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
