import type { ConsoleMessage, Page } from "puppeteer";
import { log } from "../utils/logger.js";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_CAPTURE_WAIT_MS = 1500;
const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 200;
const MAX_MESSAGE_CHARS = 400;

export type PreviewLogLevel = "debug" | "log" | "info" | "warn" | "error";
export type PreviewLogType =
  | "debug"
  | "log"
  | "info"
  | "warn"
  | "error"
  | "pageerror";

export interface PreviewLogEntry {
  type: PreviewLogType;
  text: string;
  timestamp: string;
  textTruncated: boolean;
  location?: {
    url?: string;
    line?: number;
    column?: number;
  };
}

export interface CapturePreviewLogsOptions {
  url: string;
  waitMs?: number;
  headers?: Record<string, string>;
  limit?: number;
  level?: PreviewLogLevel;
  contains?: string;
}

export interface CapturePreviewLogsResult {
  url: string;
  waitMs: number;
  limit: number;
  level: PreviewLogLevel;
  contains?: string;
  entries: PreviewLogEntry[];
  summary: {
    observed: number;
    matched: number;
    returned: number;
    dropped: number;
    truncatedMessages: number;
  };
}

function normalizeWaitMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CAPTURE_WAIT_MS;
  return Math.max(0, Math.min(Math.floor(value ?? DEFAULT_CAPTURE_WAIT_MS), 15_000));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LOG_LIMIT;
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_LOG_LIMIT), MAX_LOG_LIMIT));
}

function normalizeLevel(value: PreviewLogLevel | undefined): PreviewLogLevel {
  return value ?? "debug";
}

function normalizeContains(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function severityForLevel(level: PreviewLogLevel): number {
  switch (level) {
    case "error":
      return 4;
    case "warn":
      return 3;
    case "info":
      return 2;
    case "log":
      return 1;
    case "debug":
    default:
      return 0;
  }
}

function severityForType(type: PreviewLogType): number {
  switch (type) {
    case "pageerror":
    case "error":
      return 4;
    case "warn":
      return 3;
    case "info":
      return 2;
    case "log":
      return 1;
    case "debug":
    default:
      return 0;
  }
}

function normalizeConsoleType(consoleType: string): PreviewLogType {
  switch (consoleType) {
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warning":
      return "warn";
    case "error":
    case "assert":
      return "error";
    default:
      return "log";
  }
}

function truncateMessage(text: string): { text: string; truncated: boolean } {
  const normalized = text.trim() || "(empty message)";
  if (normalized.length <= MAX_MESSAGE_CHARS) {
    return { text: normalized, truncated: false };
  }

  return {
    text: `${normalized.slice(0, MAX_MESSAGE_CHARS - 3)}...`,
    truncated: true,
  };
}

async function applyAllowedHeaders(
  page: Page,
  headers: Record<string, string> | undefined,
): Promise<void> {
  if (!headers) return;

  const allowedHeaderKeys = new Set([
    "x-vivd-preview-token",
    "x-vivd-organization-id",
    "x-vivd-studio-token",
  ]);
  const extraHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    const normalizedKey = key.toLowerCase();
    if (!allowedHeaderKeys.has(normalizedKey)) continue;
    extraHeaders[normalizedKey] = value;
  }

  if (Object.keys(extraHeaders).length > 0) {
    await page.setExtraHTTPHeaders(extraHeaders);
  }
}

function formatConsoleText(message: ConsoleMessage): string {
  return message.text() || "(empty message)";
}

export async function capturePreviewLogs(
  page: Page,
  options: CapturePreviewLogsOptions,
): Promise<CapturePreviewLogsResult> {
  const waitMs = normalizeWaitMs(options.waitMs);
  const limit = normalizeLimit(options.limit);
  const level = normalizeLevel(options.level);
  const contains = normalizeContains(options.contains);

  log(
    `Capturing preview logs: ${options.url} (wait=${waitMs}ms, limit=${limit}, level=${level})`,
  );

  await page.setViewport({
    width: DEFAULT_VIEWPORT.width,
    height: DEFAULT_VIEWPORT.height,
    deviceScaleFactor: 1,
  });
  await applyAllowedHeaders(page, options.headers);

  const entries: PreviewLogEntry[] = [];
  const summary = {
    observed: 0,
    matched: 0,
    returned: 0,
    dropped: 0,
    truncatedMessages: 0,
  };

  const minSeverity = severityForLevel(level);

  const pushEntry = (entry: {
    type: PreviewLogType;
    text: string;
    location?: {
      url?: string;
      line?: number;
      column?: number;
    };
  }) => {
    summary.observed += 1;

    if (severityForType(entry.type) < minSeverity) return;

    const loweredText = entry.text.toLowerCase();
    if (contains && !loweredText.includes(contains)) return;

    summary.matched += 1;

    if (entries.length >= limit) {
      summary.dropped += 1;
      return;
    }

    const { text, truncated } = truncateMessage(entry.text);
    if (truncated) {
      summary.truncatedMessages += 1;
    }

    entries.push({
      type: entry.type,
      text,
      timestamp: new Date().toISOString(),
      textTruncated: truncated,
      location: entry.location,
    });
  };

  const onConsole = (message: ConsoleMessage) => {
    const location = message.location();
    pushEntry({
      type: normalizeConsoleType(message.type()),
      text: formatConsoleText(message),
      location: {
        url: location?.url || undefined,
        line:
          typeof location?.lineNumber === "number" && location.lineNumber >= 0
            ? location.lineNumber + 1
            : undefined,
        column:
          typeof location?.columnNumber === "number" && location.columnNumber >= 0
            ? location.columnNumber + 1
            : undefined,
      },
    });
  };

  const onPageError = (error: unknown) => {
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unhandled page error");
    pushEntry({
      type: "pageerror",
      text:
        normalizedError.stack ||
        normalizedError.message ||
        "Unhandled page error",
    });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const response = await page.goto(options.url, {
      waitUntil: "load",
      timeout: 45_000,
    });

    if (!response) {
      throw new Error("No response from preview URL");
    }

    const status = response.status();
    if (status >= 400) {
      let detail = "";
      try {
        const bodyText = await response.text();
        if (bodyText) {
          const compact = bodyText.replace(/\s+/g, " ").trim();
          if (compact) {
            detail = `: ${compact.slice(0, 240)}`;
          }
        }
      } catch {
        // Ignore response body parsing failures.
      }
      throw new Error(`Preview returned HTTP ${status}${detail}`);
    }

    const contentType = response.headers()["content-type"] || "";
    if (contentType.toLowerCase().includes("application/json")) {
      throw new Error(`Preview returned JSON instead of HTML (${contentType})`);
    }

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }

  summary.returned = entries.length;

  return {
    url: options.url,
    waitMs,
    limit,
    level,
    contains: options.contains?.trim() || undefined,
    entries,
    summary,
  };
}
