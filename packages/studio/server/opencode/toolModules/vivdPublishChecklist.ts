import { z } from "zod";
import type { OpencodeToolDefinition } from "./types.js";
import { callTrpcMutation, callTrpcQuery, getRuntimeConfig, validateConnectedRuntime } from "./runtime.js";

const checklistStatusSchema = z.enum(["pass", "fail", "warning", "skip", "fixed"]);

function parseRuntimeTrpcError(error: unknown): {
  message: string;
  code: string | null;
  reason: string | null;
  httpStatus: number | null;
  details: unknown;
} {
  const fallbackMessage = error instanceof Error ? error.message : String(error);
  const regexMatch = fallbackMessage.match(/\((\d{3})\):\s*([\s\S]+)$/);
  const httpStatus = regexMatch ? Number.parseInt(regexMatch[1], 10) : null;
  const rawPayload = regexMatch ? regexMatch[2].trim() : fallbackMessage;

  let parsed: any = null;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    parsed = null;
  }

  const trpcJson =
    parsed?.error?.json || parsed?.result?.error?.json || parsed?.error || null;
  const trpcData = trpcJson?.data || {};
  const code =
    typeof trpcData?.code === "string"
      ? trpcData.code
      : typeof trpcJson?.code === "string"
        ? trpcJson.code
        : null;
  const reason =
    typeof trpcData?.cause?.reason === "string"
      ? trpcData.cause.reason
      : typeof trpcJson?.cause?.reason === "string"
        ? trpcJson.cause.reason
        : null;
  const message =
    typeof trpcJson?.message === "string" && trpcJson.message.trim().length > 0
      ? trpcJson.message
      : fallbackMessage;

  return {
    message,
    code,
    reason,
    httpStatus,
    details: trpcData?.cause ?? trpcData ?? parsed ?? null,
  };
}

export const vivdPublishChecklistToolDefinition: OpencodeToolDefinition = {
  description:
    "Read or update the current project's publish checklist incrementally, one item at a time.",
  args: {
    action: z
      .enum(["describe", "update_item"])
      .describe(
        "Use 'describe' to inspect current checklist items and valid fields, or 'update_item' to patch one checklist item.",
      ),
    version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Project version. Defaults to the current studio project version from runtime context.",
      ),
    itemId: z
      .string()
      .min(1)
      .optional()
      .describe("Required for update_item. Must match an existing checklist item id."),
    status: checklistStatusSchema
      .optional()
      .describe("Required for update_item. New status for the selected checklist item."),
    note: z
      .string()
      .max(4_000)
      .optional()
      .describe("Optional note for update_item."),
  },
  async execute(args) {
    const config = getRuntimeConfig();
    const validationError = validateConnectedRuntime(config, "vivd_publish_checklist");
    if (validationError) return validationError;

    const version = args.version ?? config.projectVersion ?? 1;

    try {
      if (args.action === "describe") {
        const payload = await callTrpcQuery(
          "studioApi.getPublishChecklist",
          {
            studioId: config.studioId,
            slug: config.projectSlug,
            version,
          },
          config,
        );

        return JSON.stringify(
          {
            tool: "vivd_publish_checklist",
            ok: true,
            action: "describe",
            project: {
              slug: config.projectSlug,
              version,
            },
            updateContract: {
              requiresExistingChecklist: true,
              updatableFields: ["itemId", "status", "note"],
              allowedStatuses: checklistStatusSchema.options,
            },
            checklist: payload?.checklist ?? null,
            stale: Boolean(payload?.stale ?? true),
            staleReason: payload?.reason ?? "missing",
          },
          null,
          2,
        );
      }

      if (!args.itemId) {
        return JSON.stringify(
          {
            tool: "vivd_publish_checklist",
            ok: false,
            action: "update_item",
            error: {
              code: "BAD_REQUEST",
              message: "Missing required field: itemId",
            },
          },
          null,
          2,
        );
      }

      if (!args.status) {
        return JSON.stringify(
          {
            tool: "vivd_publish_checklist",
            ok: false,
            action: "update_item",
            error: {
              code: "BAD_REQUEST",
              message: "Missing required field: status",
            },
          },
          null,
          2,
        );
      }

      const payload = await callTrpcMutation(
        "studioApi.updatePublishChecklistItem",
        {
          studioId: config.studioId,
          slug: config.projectSlug,
          version,
          itemId: args.itemId,
          status: args.status,
          note: args.note,
        },
        config,
      );

      return JSON.stringify(
        {
          tool: "vivd_publish_checklist",
          ok: true,
          action: "update_item",
          project: {
            slug: config.projectSlug,
            version,
          },
          item: payload?.item ?? null,
          summary: payload?.checklist?.summary ?? null,
          checklist: payload?.checklist ?? null,
        },
        null,
        2,
      );
    } catch (error) {
      const parsed = parseRuntimeTrpcError(error);
      return JSON.stringify(
        {
          tool: "vivd_publish_checklist",
          ok: false,
          action: args.action,
          project: {
            slug: config.projectSlug,
            version,
          },
          error: parsed,
        },
        null,
        2,
      );
    }
  },
};
