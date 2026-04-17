import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { ProjectPluginAccessRequestState } from "@vivd/plugin-sdk";
import { db } from "../../db";
import {
  organization,
  projectMeta,
  projectPluginAccessRequest,
} from "../../db/schema";
import { emailTemplateBrandingService } from "../email/templateBranding";
import { getEmailDeliveryService } from "../integrations/EmailDeliveryService";
import { getPluginManifest, type PluginId } from "./catalog";

type ProjectPluginAccessRequestRow = typeof projectPluginAccessRequest.$inferSelect;
type ErrorWithCause = {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
};

let hasWarnedAboutMissingAccessRequestStorage = false;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toAccessRequestState(
  row: ProjectPluginAccessRequestRow | null | undefined,
): ProjectPluginAccessRequestState {
  if (!row || row.status !== "pending") {
    return {
      status: "not_requested",
      requestedAt: null,
      requestedByUserId: null,
      requesterEmail: null,
    };
  }

  return {
    status: "pending",
    requestedAt: row.requestedAt?.toISOString() ?? null,
    requestedByUserId: row.requestedByUserId ?? null,
    requesterEmail: row.requesterEmail?.trim() || null,
  };
}

function collectErrorChain(error: unknown): ErrorWithCause[] {
  const chain: ErrorWithCause[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current as ErrorWithCause);
    current = (current as ErrorWithCause).cause;
  }

  return chain;
}

function getErrorMessage(error: ErrorWithCause | null | undefined): string {
  return typeof error?.message === "string" ? error.message : "";
}

function getErrorCode(error: ErrorWithCause | null | undefined): string {
  return typeof error?.code === "string" ? error.code : "";
}

function isMissingAccessRequestStorageError(error: unknown): boolean {
  const chain = collectErrorChain(error);

  return chain.some((entry) => {
    const message = getErrorMessage(entry).toLowerCase();
    const code = getErrorCode(entry);

    if (
      (code === "42P01" || code === "42703") &&
      message.includes("project_plugin_access_request")
    ) {
      return true;
    }

    if (
      message.includes("project_plugin_access_request") &&
      (message.includes("does not exist") ||
        message.includes("undefined table") ||
        message.includes("undefined column"))
    ) {
      return true;
    }

    if (
      message.includes("requested_by_user_id") &&
      (message.includes("does not exist") || message.includes("undefined column"))
    ) {
      return true;
    }

    return false;
  });
}

function isPluginAccessRequestWrapperError(
  error: unknown,
  operation: "select" | "update",
): boolean {
  const chain = collectErrorChain(error);

  return chain.some((entry) => {
    const message = getErrorMessage(entry).toLowerCase();
    return (
      message.includes(`failed query: ${operation}`) &&
      message.includes('"project_plugin_access_request"')
    );
  });
}

function warnMissingAccessRequestStorage(error: unknown): void {
  if (hasWarnedAboutMissingAccessRequestStorage) return;
  hasWarnedAboutMissingAccessRequestStorage = true;

  const detail =
    collectErrorChain(error)
      .map((entry) => getErrorMessage(entry).trim())
      .find((message) => message.length > 0) ?? "unknown error";

  console.warn(
    `[Plugins] project_plugin_access_request storage is unavailable or out of date; falling back to stateless plugin access requests. Run backend db:migrate to apply migration 0026_fancy_arclight.sql. Error: ${detail}`,
  );
}

class PluginAccessRequestService {
  async getRequestState(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginAccessRequestState> {
    try {
      const row = await db.query.projectPluginAccessRequest.findFirst({
        where: and(
          eq(projectPluginAccessRequest.organizationId, options.organizationId),
          eq(projectPluginAccessRequest.projectSlug, options.projectSlug),
          eq(projectPluginAccessRequest.pluginId, options.pluginId),
        ),
      });

      return toAccessRequestState(row);
    } catch (error) {
      if (
        !isMissingAccessRequestStorageError(error) &&
        !isPluginAccessRequestWrapperError(error, "select")
      ) {
        throw error;
      }

      warnMissingAccessRequestStorage(error);
      return toAccessRequestState(null);
    }
  }

  async listRequestStates(options: {
    organizationId: string;
    projectSlug: string;
    pluginIds: PluginId[];
  }): Promise<Map<PluginId, ProjectPluginAccessRequestState>> {
    if (options.pluginIds.length === 0) return new Map();

    try {
      const rows = await db.query.projectPluginAccessRequest.findMany({
        where: and(
          eq(projectPluginAccessRequest.organizationId, options.organizationId),
          eq(projectPluginAccessRequest.projectSlug, options.projectSlug),
          inArray(projectPluginAccessRequest.pluginId, options.pluginIds),
        ),
      });

      return new Map(
        rows.map((row) => [row.pluginId as PluginId, toAccessRequestState(row)]),
      );
    } catch (error) {
      if (
        !isMissingAccessRequestStorageError(error) &&
        !isPluginAccessRequestWrapperError(error, "select")
      ) {
        throw error;
      }

      warnMissingAccessRequestStorage(error);
      return new Map();
    }
  }

  async requestAccess(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
    requestedByUserId: string;
    requesterEmail: string;
    requesterName?: string | null;
  }): Promise<ProjectPluginAccessRequestState> {
    let existing: ProjectPluginAccessRequestRow | null = null;
    try {
      existing =
        (await db.query.projectPluginAccessRequest.findFirst({
          where: and(
            eq(projectPluginAccessRequest.organizationId, options.organizationId),
            eq(projectPluginAccessRequest.projectSlug, options.projectSlug),
            eq(projectPluginAccessRequest.pluginId, options.pluginId),
          ),
        })) ?? null;
    } catch (error) {
      if (
        !isMissingAccessRequestStorageError(error) &&
        !isPluginAccessRequestWrapperError(error, "select")
      ) {
        throw error;
      }

      warnMissingAccessRequestStorage(error);
    }

    if (existing?.status === "pending") {
      return toAccessRequestState(existing);
    }

    const [branding, orgRecord, projectRecord] = await Promise.all([
      emailTemplateBrandingService.getResolvedBranding(),
      db.query.organization.findFirst({
        where: eq(organization.id, options.organizationId),
        columns: { name: true, slug: true },
      }),
      db.query.projectMeta.findFirst({
        where: and(
          eq(projectMeta.organizationId, options.organizationId),
          eq(projectMeta.slug, options.projectSlug),
        ),
        columns: { title: true, slug: true },
      }),
    ]);

    const supportEmail = branding.supportEmail?.trim() || null;
    if (!supportEmail) {
      throw new Error("Support email is not configured for plugin access requests");
    }

    const pluginName = getPluginManifest(options.pluginId).definition.name;
    const projectLabel =
      projectRecord?.title?.trim() || projectRecord?.slug || options.projectSlug;
    const organizationLabel =
      orgRecord?.name?.trim() || orgRecord?.slug || options.organizationId;
    const requesterIdentity =
      options.requesterName?.trim() || options.requesterEmail.trim() || options.requestedByUserId;
    const requesterEmail = options.requesterEmail.trim() || "unknown";
    const subject = `Plugin access request: ${pluginName} for ${projectLabel}`;
    const text = [
      "A project member requested plugin access.",
      "",
      `Organization: ${organizationLabel}`,
      `Project: ${projectLabel} (${options.projectSlug})`,
      `Plugin: ${pluginName} (${options.pluginId})`,
      `Requester: ${requesterIdentity}`,
      `Requester email: ${requesterEmail}`,
      `Requester user ID: ${options.requestedByUserId}`,
    ].join("\n");
    const html = [
      "<p>A project member requested plugin access.</p>",
      "<ul>",
      `<li><strong>Organization:</strong> ${escapeHtml(organizationLabel)}</li>`,
      `<li><strong>Project:</strong> ${escapeHtml(projectLabel)} (${escapeHtml(options.projectSlug)})</li>`,
      `<li><strong>Plugin:</strong> ${escapeHtml(pluginName)} (${escapeHtml(options.pluginId)})</li>`,
      `<li><strong>Requester:</strong> ${escapeHtml(requesterIdentity)}</li>`,
      `<li><strong>Requester email:</strong> ${escapeHtml(requesterEmail)}</li>`,
      `<li><strong>Requester user ID:</strong> ${escapeHtml(options.requestedByUserId)}</li>`,
      "</ul>",
    ].join("");

    const result = await getEmailDeliveryService().send({
      to: [supportEmail],
      subject,
      text,
      html,
      replyTo: options.requesterEmail.trim() || undefined,
      metadata: {
        notification_type: "plugin_access_request",
        plugin_id: options.pluginId,
        organization_id: options.organizationId,
        project_slug: options.projectSlug,
      },
    });

    if (!result.accepted) {
      throw new Error(result.error || "Failed to send plugin access request email");
    }

    const now = new Date();
    try {
      const [saved] = await db
        .insert(projectPluginAccessRequest)
        .values({
          id: existing?.id ?? randomUUID(),
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: options.pluginId,
          status: "pending",
          requestedByUserId: options.requestedByUserId,
          requesterEmail: options.requesterEmail.trim(),
          emailProvider: result.provider,
          emailMessageId: result.messageId ?? null,
          requestedAt: now,
          resolvedAt: null,
        })
        .onConflictDoUpdate({
          target: [
            projectPluginAccessRequest.organizationId,
            projectPluginAccessRequest.projectSlug,
            projectPluginAccessRequest.pluginId,
          ],
          set: {
            status: "pending",
            requestedByUserId: options.requestedByUserId,
            requesterEmail: options.requesterEmail.trim(),
            emailProvider: result.provider,
            emailMessageId: result.messageId ?? null,
            requestedAt: now,
            resolvedAt: null,
            updatedAt: now,
          },
        })
        .returning();

      return toAccessRequestState(saved);
    } catch (error) {
      if (
        !isMissingAccessRequestStorageError(error) &&
        !isPluginAccessRequestWrapperError(error, "update")
      ) {
        throw error;
      }

      warnMissingAccessRequestStorage(error);
      return {
        status: "pending",
        requestedAt: now.toISOString(),
        requestedByUserId: options.requestedByUserId,
        requesterEmail: options.requesterEmail.trim() || null,
      };
    }
  }

  async resolveRequest(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<void> {
    try {
      await db
        .update(projectPluginAccessRequest)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(projectPluginAccessRequest.organizationId, options.organizationId),
            eq(projectPluginAccessRequest.projectSlug, options.projectSlug),
            eq(projectPluginAccessRequest.pluginId, options.pluginId),
          ),
        );
    } catch (error) {
      if (!isMissingAccessRequestStorageError(error)) {
        throw error;
      }

      warnMissingAccessRequestStorage(error);
    }
  }
}

export const pluginAccessRequestService = new PluginAccessRequestService();
