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

class PluginAccessRequestService {
  async getRequestState(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<ProjectPluginAccessRequestState> {
    const row = await db.query.projectPluginAccessRequest.findFirst({
      where: and(
        eq(projectPluginAccessRequest.organizationId, options.organizationId),
        eq(projectPluginAccessRequest.projectSlug, options.projectSlug),
        eq(projectPluginAccessRequest.pluginId, options.pluginId),
      ),
    });

    return toAccessRequestState(row);
  }

  async listRequestStates(options: {
    organizationId: string;
    projectSlug: string;
    pluginIds: PluginId[];
  }): Promise<Map<PluginId, ProjectPluginAccessRequestState>> {
    if (options.pluginIds.length === 0) return new Map();

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
  }

  async requestAccess(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
    requestedByUserId: string;
    requesterEmail: string;
    requesterName?: string | null;
  }): Promise<ProjectPluginAccessRequestState> {
    const existing = await db.query.projectPluginAccessRequest.findFirst({
      where: and(
        eq(projectPluginAccessRequest.organizationId, options.organizationId),
        eq(projectPluginAccessRequest.projectSlug, options.projectSlug),
        eq(projectPluginAccessRequest.pluginId, options.pluginId),
      ),
    });

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
  }

  async resolveRequest(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: PluginId;
  }): Promise<void> {
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
  }
}

export const pluginAccessRequestService = new PluginAccessRequestService();
