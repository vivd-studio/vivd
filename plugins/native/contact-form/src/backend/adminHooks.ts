import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { contactFormPluginConfigSchema } from "./config";
import { startContactSubmissionRetentionJob } from "./retention";
import { startContactFormTurnstileSyncJob } from "./turnstile";
import type { ContactFormAdminHooksDeps } from "./ports";

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

export function createContactFormPluginBackendHooks(
  deps: ContactFormAdminHooksDeps,
) {
  return {
    async listProjectUsageCounts(options: {
      organizationId?: string;
      startedAt: Date;
    }): Promise<Array<{
      organizationId: string;
      projectSlug: string;
      count: number;
    }>> {
      const rows = await deps.db
        .select({
          organizationId: deps.tables.contactFormSubmission.organizationId,
          projectSlug: deps.tables.contactFormSubmission.projectSlug,
          count: sql<number>`count(*)`,
        })
        .from(deps.tables.contactFormSubmission)
        .where(
          and(
            gte(
              deps.tables.contactFormSubmission.createdAt,
              options.startedAt,
            ),
            options.organizationId
              ? eq(
                  deps.tables.contactFormSubmission.organizationId,
                  options.organizationId,
                )
              : undefined,
          ),
        )
        .groupBy(
          deps.tables.contactFormSubmission.organizationId,
          deps.tables.contactFormSubmission.projectSlug,
        );

      return rows.map((row: any) => ({
        organizationId: row.organizationId,
        projectSlug: row.projectSlug,
        count: Number(row.count) || 0,
      }));
    },

    async buildOrganizationProjectSummaries(options: {
      organizationId: string;
      projectSlugs: string[];
      instancesByProjectSlug: Map<string, ContactFormOrganizationInstanceSnapshot | null>;
    }): Promise<Map<string, ContactFormOrganizationProjectSummary>> {
      if (options.projectSlugs.length === 0) {
        return new Map();
      }

      const [pendingRecipientRows, entitlementRows] = await Promise.all([
        deps.db
          .select({
            projectSlug: deps.tables.contactFormRecipientVerification.projectSlug,
            count: sql<number>`count(*)`,
          })
          .from(deps.tables.contactFormRecipientVerification)
          .where(
            and(
              eq(
                deps.tables.contactFormRecipientVerification.organizationId,
                options.organizationId,
              ),
              inArray(
                deps.tables.contactFormRecipientVerification.projectSlug,
                options.projectSlugs,
              ),
              eq(deps.tables.contactFormRecipientVerification.status, "pending"),
            ),
          )
          .groupBy(deps.tables.contactFormRecipientVerification.projectSlug),
        deps.db.query.pluginEntitlement.findMany({
          where: and(
            eq(deps.tables.pluginEntitlement.organizationId, options.organizationId),
            eq(deps.tables.pluginEntitlement.pluginId, "contact_form"),
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
        pendingRecipientRows.map((row: any) => [row.projectSlug, Number(row.count) || 0]),
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
    },

    async prepareProjectEntitlementFields(options: {
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
        deps.turnstileService.getAutomationConfigurationIssue();
      if (automationIssue) {
        throw new Error(automationIssue);
      }

      const prepared = await deps.turnstileService.prepareProjectWidgetCredentials({
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
    },

    async cleanupProjectEntitlementFields(options: {
      state: "disabled" | "enabled" | "suspended";
      turnstileEnabled: boolean;
      existingProjectEntitlement: ContactFormProjectEntitlementSnapshot | null;
    }): Promise<void> {
      if (options.state === "enabled" && options.turnstileEnabled === true) {
        return;
      }

      const widgetId = options.existingProjectEntitlement?.turnstileWidgetId;
      if (!widgetId) return;

      await deps.turnstileService.deleteWidget(widgetId);
    },

    async renameProjectSlugData(options: {
      tx: {
        update(table: any): any;
      };
      organizationId: string;
      oldSlug: string;
      newSlug: string;
    }): Promise<number> {
      const updatedContactSubmissions = await options.tx
        .update(deps.tables.contactFormSubmission)
        .set({ projectSlug: options.newSlug })
        .where(
          and(
            eq(
              deps.tables.contactFormSubmission.organizationId,
              options.organizationId,
            ),
            eq(deps.tables.contactFormSubmission.projectSlug, options.oldSlug),
          ),
        )
        .returning({ id: deps.tables.contactFormSubmission.id });

      const updatedRecipientVerifications = await options.tx
        .update(deps.tables.contactFormRecipientVerification)
        .set({ projectSlug: options.newSlug, updatedAt: new Date() })
        .where(
          and(
            eq(
              deps.tables.contactFormRecipientVerification.organizationId,
              options.organizationId,
            ),
            eq(
              deps.tables.contactFormRecipientVerification.projectSlug,
              options.oldSlug,
            ),
          ),
        )
        .returning({ id: deps.tables.contactFormRecipientVerification.id });

      return (
        updatedContactSubmissions.length + updatedRecipientVerifications.length
      );
    },

    startBackgroundJobs() {
      const stopContactSubmissionRetention = startContactSubmissionRetentionJob({
        db: deps.db,
        tables: {
          contactFormSubmission: deps.tables.contactFormSubmission,
        },
      });
      const stopContactFormTurnstileSync =
        startContactFormTurnstileSyncJob(deps.turnstileService);

      return [
        stopContactSubmissionRetention,
        stopContactFormTurnstileSync,
      ] as const;
    },
  };
}
