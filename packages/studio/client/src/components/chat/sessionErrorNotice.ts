import type { SessionError } from "./chatTypes";

export type SessionErrorNoticeTone = "warning" | "destructive";

export type SessionErrorNoticeContent = {
  title: string;
  detail?: string;
  tone: SessionErrorNoticeTone;
  showSpinner: boolean;
};

function formatRetryCountdown(
  nextRetryAt?: number,
  now: number = Date.now(),
): string | null {
  if (typeof nextRetryAt !== "number") {
    return null;
  }

  const seconds = Math.max(0, Math.round((nextRetryAt - now) / 1000));
  return seconds > 0
    ? `Retrying automatically in ${seconds}s`
    : "Retrying automatically";
}

function joinNoticeDetail(parts: Array<string | null | undefined>): string | undefined {
  const detail = parts.filter(Boolean).join(" • ");
  return detail || undefined;
}

export function buildSessionErrorNotice(
  error: SessionError,
  now: number = Date.now(),
): SessionErrorNoticeContent {
  if (error.type === "retry") {
    return {
      title: error.message,
      detail: joinNoticeDetail([
        formatRetryCountdown(error.nextRetryAt, now) ?? "Retrying automatically",
        error.attempt ? `Attempt ${error.attempt}` : null,
      ]),
      tone: "warning",
      showSpinner: true,
    };
  }

  if (error.type === "stream" || error.type === "provider_limit") {
    return {
      title: error.message,
      detail: joinNoticeDetail([
        error.attempt ? `Attempt ${error.attempt}` : null,
      ]),
      tone: "warning",
      showSpinner: false,
    };
  }

  return {
    title: error.message,
    detail: joinNoticeDetail([
      error.attempt ? `Attempt ${error.attempt}` : null,
    ]),
    tone: "destructive",
    showSpinner: false,
  };
}
