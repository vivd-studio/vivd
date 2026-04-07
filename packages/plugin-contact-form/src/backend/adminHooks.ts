import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@vivd/backend/src/db";
import {
  contactFormRecipientVerification,
  pluginEntitlement,
} from "@vivd/backend/src/db/schema";
import { contactFormPluginConfigSchema } from "./config";
import { contactFormTurnstileService } from "./turnstile";

type ContactFormIssueCode =
  | "contact_no_recipients"
  | "contact_pending_recipients"
  | "contact_turnstile_not_ready";

export interface ContactFormOrganizationInstanceSnapshot {
  status: string | null;
  configJson: unknown;
}

export interface ContactFormOrganizationProjectIssue {
  code: ContactFormIssueCode;
  severity: "warning" | "info";
  message: string;
}

export interface ContactFormOrganizationProjectBadge {
  label: string;
  tone: "success" | "destructive";
}

export interface ContactFormOrganizationProjectSummary {
  summaryLines: string[];
  badges: ContactFormOrganizationProjectBadge[];
  issues: ContactFormOrganizationProjectIssue[];
}

interface ContactEntitlementSummary {
  state: string;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

function getConfiguredRecipientCount(configJson: unknown): number {
  const parsed = contactFormPluginConfigSchema.safeParse(configJson ?? {});
  if (!parsed.success) return 0;
  return parsed.data.recipientEmails.length;
}

export async function buildContactFormOrganizationProjectSummaries(options: {
  organizationId: string;
  projectSlugs: string[];
  instancesByProjectSlug: Map<string, ContactFormOrganizationInstanceSnapshot | null>;
}): Promise<Map<string, ContactFormOrganizationProjectSummary>> {
  if (options.projectSlugs.length === 0) {
    return new Map();
  }

  const [pendingRecipientRows, entitlementRows] = await Promise.all([
    db
      .select({
        projectSlug: contactFormRecipientVerification.projectSlug,
        count: sql<number>`count(*)`,
      })
      .from(contactFormRecipientVerification)
      .where(
        and(
          eq(contactFormRecipientVerification.organizationId, options.organizationId),
          inArray(contactFormRecipientVerification.projectSlug, options.projectSlugs),
          eq(contactFormRecipientVerification.status, "pending"),
        ),
      )
      .groupBy(contactFormRecipientVerification.projectSlug),
    db.query.pluginEntitlement.findMany({
      where: and(
        eq(pluginEntitlement.organizationId, options.organizationId),
        eq(pluginEntitlement.pluginId, "contact_form"),
      ),
      columns: {
        scope: true,
        projectSlug: true,
        state: true,
        turnstileEnabled: true,
        turnstileSiteKey: true,
        turnstileSecretKey: true,
      },
    }),
  ]);

  const pendingRecipientsByProjectSlug = new Map<string, number>(
    pendingRecipientRows.map((row) => [row.projectSlug, Number(row.count) || 0]),
  );

  const contactEntitlementByProjectSlug = new Map<string, ContactEntitlementSummary>();
  let organizationContactEntitlement: ContactEntitlementSummary | null = null;
  for (const row of entitlementRows) {
    const normalized = {
      state: row.state,
      turnstileEnabled: row.turnstileEnabled ?? false,
      turnstileSiteKey: row.turnstileSiteKey ?? null,
      turnstileSecretKey: row.turnstileSecretKey ?? null,
    } satisfies ContactEntitlementSummary;

    if (row.scope === "project" && row.projectSlug) {
      contactEntitlementByProjectSlug.set(row.projectSlug, normalized);
    } else if (row.scope === "organization") {
      organizationContactEntitlement = normalized;
    }
  }

  const summaries = new Map<string, ContactFormOrganizationProjectSummary>();
  for (const projectSlug of options.projectSlugs) {
    const instance = options.instancesByProjectSlug.get(projectSlug) ?? null;
    const enabled = instance?.status === "enabled";
    const configuredRecipientCount = instance
      ? getConfiguredRecipientCount(instance.configJson)
      : 0;
    const pendingRecipientCount =
      pendingRecipientsByProjectSlug.get(projectSlug) ?? 0;
    const effectiveEntitlement =
      contactEntitlementByProjectSlug.get(projectSlug) ??
      organizationContactEntitlement;
    const turnstileEnabled =
      effectiveEntitlement?.state === "enabled" &&
      effectiveEntitlement.turnstileEnabled;
    const turnstileReady =
      turnstileEnabled &&
      !!effectiveEntitlement?.turnstileSiteKey &&
      !!effectiveEntitlement?.turnstileSecretKey;

    const summaryLines: string[] = [];
    const badges: ContactFormOrganizationProjectBadge[] = [];
    const issues: ContactFormOrganizationProjectIssue[] = [];

    if (enabled) {
      summaryLines.push(`Recipients configured: ${configuredRecipientCount}`);
      if (pendingRecipientCount > 0) {
        summaryLines.push(`Pending verification: ${pendingRecipientCount}`);
      }
      if (turnstileEnabled) {
        badges.push({
          label: turnstileReady ? "Turnstile ready" : "Turnstile syncing",
          tone: turnstileReady ? "success" : "destructive",
        });
      }
      if (configuredRecipientCount === 0) {
        issues.push({
          code: "contact_no_recipients",
          severity: "warning",
          message:
            "Contact Form is enabled but has no verified recipients configured.",
        });
      }
      if (pendingRecipientCount > 0) {
        const noun = pendingRecipientCount === 1 ? "recipient" : "recipients";
        issues.push({
          code: "contact_pending_recipients",
          severity: "info",
          message: `${pendingRecipientCount} ${noun} pending verification.`,
        });
      }
      if (turnstileEnabled && !turnstileReady) {
        issues.push({
          code: "contact_turnstile_not_ready",
          severity: "warning",
          message: "Turnstile is enabled but credentials are not ready yet.",
        });
      }
    }

    summaries.set(projectSlug, {
      summaryLines,
      badges,
      issues,
    });
  }

  return summaries;
}

export interface ContactFormProjectEntitlementSnapshot {
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export interface ContactFormPreparedEntitlementFields {
  turnstileEnabled: boolean;
  turnstileWidgetId: string | null;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
}

export async function prepareContactFormEntitlementFields(options: {
  organizationId: string;
  projectSlug: string;
  state: "disabled" | "enabled" | "suspended";
  turnstileEnabled: boolean;
  existingProjectEntitlement: ContactFormProjectEntitlementSnapshot | null;
}): Promise<ContactFormPreparedEntitlementFields> {
  if (options.state !== "enabled" || options.turnstileEnabled !== true) {
    return {
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
    };
  }

  const automationIssue =
    contactFormTurnstileService.getAutomationConfigurationIssue();
  if (automationIssue) {
    throw new Error(automationIssue);
  }

  const prepared = await contactFormTurnstileService.prepareProjectWidgetCredentials({
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    existingWidgetId: options.existingProjectEntitlement?.turnstileWidgetId ?? null,
    existingSiteKey: options.existingProjectEntitlement?.turnstileSiteKey ?? null,
    existingSecretKey: options.existingProjectEntitlement?.turnstileSecretKey ?? null,
  });

  return {
    turnstileEnabled: true,
    turnstileWidgetId: prepared.widgetId,
    turnstileSiteKey: prepared.siteKey,
    turnstileSecretKey: prepared.secretKey,
  };
}

export async function cleanupContactFormEntitlementFields(options: {
  state: "disabled" | "enabled" | "suspended";
  turnstileEnabled: boolean;
  existingProjectEntitlement: ContactFormProjectEntitlementSnapshot | null;
}): Promise<void> {
  if (options.state === "enabled" && options.turnstileEnabled === true) {
    return;
  }

  const widgetId = options.existingProjectEntitlement?.turnstileWidgetId;
  if (!widgetId) return;

  await contactFormTurnstileService.deleteWidget(widgetId);
}
