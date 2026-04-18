import { z } from "zod";
import { PLUGIN_IDS } from "../../services/plugins/catalog";

export const tokenDataSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
});

export const studioUsageReportSchema = z.object({
  sessionId: z.string(),
  sessionTitle: z.string().optional(),
  cost: z.number(),
  tokens: tokenDataSchema.optional(),
  partId: z.string().optional(),
  projectPath: z.string().optional(),
  timestamp: z.string(),
});

export const studioImageGenerationReportSchema = z.object({
  projectPath: z.string().optional(),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
  timestamp: z.string(),
});

export const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "fail", "warning", "skip", "fixed"]),
  note: z.string().optional(),
});

export const prePublishChecklistSchema = z.object({
  projectSlug: z.string(),
  version: z.number().int().positive(),
  runAt: z.string(),
  snapshotCommitHash: z.string().optional(),
  items: z.array(checklistItemSchema),
  summary: z.object({
    passed: z.number(),
    failed: z.number(),
    warnings: z.number(),
    skipped: z.number(),
    fixed: z.number().optional(),
  }),
});

export const previewScreenshotSchema = z.object({
  path: z.string(),
  capturedUrl: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  format: z.enum(["png", "jpeg", "webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scrollX: z.number().int().nonnegative(),
  scrollY: z.number().int().nonnegative(),
  imageBase64: z.string(),
});

export const previewLogLevelSchema = z.enum(["debug", "log", "info", "warn", "error"]);

export const previewLogEntrySchema = z.object({
  type: z.enum(["debug", "log", "info", "warn", "error", "pageerror"]),
  text: z.string(),
  timestamp: z.string(),
  textTruncated: z.boolean(),
  location: z
    .object({
      url: z.string().optional(),
      line: z.number().int().positive().optional(),
      column: z.number().int().positive().optional(),
    })
    .optional(),
});

export const previewLogsSchema = z.object({
  path: z.string(),
  capturedUrl: z.string(),
  waitMs: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  level: previewLogLevelSchema,
  contains: z.string().optional(),
  entries: z.array(previewLogEntrySchema),
  summary: z.object({
    observed: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    truncatedMessages: z.number().int().nonnegative(),
  }),
});

export const previewStatusSchema = z.object({
  provider: z.enum(["local", "fly", "docker"]),
  runtime: z.object({
    running: z.boolean(),
    health: z.enum(["ok", "starting", "unreachable", "stopped"]),
    browserUrl: z.string().nullable(),
    runtimeUrl: z.string().nullable(),
    compatibilityUrl: z.string().nullable(),
    error: z.string().optional(),
  }),
  preview: z.object({
    mode: z.enum(["static", "devserver", "unknown"]),
    status: z.enum(["ready", "starting", "installing", "error", "unavailable"]),
    error: z.string().optional(),
  }),
  devServer: z.object({
    applicable: z.boolean(),
    running: z.boolean(),
    status: z.enum([
      "ready",
      "starting",
      "installing",
      "error",
      "not_applicable",
      "unknown",
    ]),
  }),
});

export const projectInfoInputSchema = z.object({
  studioId: z.string(),
  slug: z.string().min(1),
  version: z.number().int().positive().optional(),
});

export const pluginIdSchema = z.enum(PLUGIN_IDS);
