import { z } from "zod";
import crypto from "node:crypto";
import { router, superAdminProcedure } from "../trpc";
import { db } from "../db";
import {
  organization,
  organizationMember,
  projectMember,
  projectMeta,
  user as userTable,
} from "../db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "../auth";
import { limitsService } from "../services/usage/LimitsService";
import { usageService } from "../services/usage/UsageService";
import { domainService, validateOrganizationSlug } from "../services/publish/DomainService";
import { studioMachineProvider } from "../services/studioMachines";
import { isManagedStudioMachineProvider } from "../services/studioMachines/types";
import { pluginEntitlementService } from "../services/plugins/PluginEntitlementService";
import { projectPluginService } from "../services/plugins/ProjectPluginService";
import { contactFormTurnstileService } from "../services/plugins/contactForm/turnstile";
import { getEmailFeedbackEndpoint } from "../services/plugins/contactForm/publicApi";
import { emailDeliverabilityService } from "../services/email/deliverability";
import { PLUGIN_IDS } from "../services/plugins/registry";
import {
  getSystemSettingValue,
  setSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "../services/system/SystemSettingsService";
import {
  installProfileSchema,
  installProfileService,
  instancePluginDefaultsSchema,
  partialInstanceCapabilityPolicySchema,
} from "../services/system/InstallProfileService";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService";
import {
  listStudioImagesFromGhcr,
  normalizeGhcrRepository,
} from "../services/studioMachines/fly/ghcr";
import {
  organizationIdSchema,
  organizationSlugSchema,
} from "../lib/organizationIdentifiers";

function headersFromNode(reqHeaders: Record<string, unknown>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (typeof value === "string") {
      headers.append(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") headers.append(key, entry);
      }
    }
  }
  return headers;
}

const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "client_editor",
]);
const domainUsageSchema = z.enum(["tenant_host", "publish_target"]);
const domainTypeSchema = z.enum(["managed_subdomain", "custom_domain"]);
const domainStatusSchema = z.enum(["active", "disabled", "pending_verification"]);

const orgMemberRoleSchema = z.enum(["owner", "admin", "member", "client_editor"]);
const pluginIdSchema = z.enum(PLUGIN_IDS);
const pluginEntitlementScopeSchema = z.enum(["organization", "project"]);
const pluginEntitlementStateSchema = z.enum([
  "disabled",
  "enabled",
  "suspended",
]);
const emailDeliverabilityPolicyInputSchema = z.object({
  autoSuppressBounces: z.boolean(),
  autoSuppressComplaints: z.boolean(),
  complaintRateThresholdPercent: z.number().min(0).max(100),
  bounceRateThresholdPercent: z.number().min(0).max(100),
});

const instanceLimitDefaultsPatchSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().nullable().optional(),
    weeklyCreditLimit: z.number().nonnegative().nullable().optional(),
    monthlyCreditLimit: z.number().nonnegative().nullable().optional(),
    imageGenPerMonth: z.number().int().nonnegative().nullable().optional(),
    warningThreshold: z.number().min(0.1).max(1).nullable().optional(),
    maxProjects: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

function getGlobalUserRoleForOrganizationRole(
  _role: z.infer<typeof organizationRoleSchema>,
): "user" {
  return "user";
}

const limitsPatchSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().optional(),
    weeklyCreditLimit: z.number().nonnegative().optional(),
    monthlyCreditLimit: z.number().nonnegative().optional(),
    imageGenPerMonth: z.number().int().nonnegative().optional(),
    warningThreshold: z.number().min(0).max(1).optional(),
    maxProjects: z.number().int().nonnegative().optional(),
  })
  .strict();

const authCreateUserResponseSchema = z
  .object({
    user: z.object({
      id: z.string().min(1),
    }),
  })
  .passthrough();

function managedStudioImageProviderKind(): "fly" | "docker" | null {
  if (!isManagedStudioMachineProvider(studioMachineProvider)) return null;
  return studioMachineProvider.kind === "docker" ? "docker" : "fly";
}

function getStudioImageEnvConfig(provider: "fly" | "docker"): {
  repositoryEnvVar: "FLY_STUDIO_IMAGE_REPO" | "DOCKER_STUDIO_IMAGE_REPO";
  imageEnvVar: "FLY_STUDIO_IMAGE" | "DOCKER_STUDIO_IMAGE";
  repository: string;
  envOverrideImage: string | null;
} {
  const repositoryEnvVar =
    provider === "docker" ? "DOCKER_STUDIO_IMAGE_REPO" : "FLY_STUDIO_IMAGE_REPO";
  const imageEnvVar =
    provider === "docker" ? "DOCKER_STUDIO_IMAGE" : "FLY_STUDIO_IMAGE";

  const configuredRepository = process.env[repositoryEnvVar]?.trim();
  const repository = configuredRepository || "ghcr.io/vivd-studio/vivd-studio";
  const envOverrideRaw = process.env[imageEnvVar]?.trim();

  return {
    repositoryEnvVar,
    imageEnvVar,
    repository,
    envOverrideImage:
      envOverrideRaw && envOverrideRaw.length > 0 ? envOverrideRaw : null,
  };
}

function normalizeStudioImageRepoConfigured(provider: "fly" | "docker"): string {
  const configured = getStudioImageEnvConfig(provider).repository;
  if (configured) return configured;
  return "ghcr.io/vivd-studio/vivd-studio";
}

function fallbackStudioImageBase(repo: string): string {
  try {
    return normalizeGhcrRepository(repo).imageBase;
  } catch {
    return "ghcr.io/vivd-studio/vivd-studio";
  }
}

const STUDIO_IMAGE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export const superAdminRouter = router({
  getInstanceSettings: superAdminProcedure.query(async () => {
    const policy = await installProfileService.resolvePolicy();
    return {
      installProfile: policy.installProfile,
      singleProjectMode: policy.singleProjectMode,
      instanceAdminLabel:
        policy.installProfile === "solo" ? "Instance Settings" : "Super Admin",
      capabilities: policy.capabilities,
      pluginDefaults: Object.fromEntries(
        PLUGIN_IDS.map((pluginId) => [
          pluginId,
          {
            enabled: policy.pluginDefaults[pluginId].state === "enabled",
          },
        ]),
      ),
      limitDefaults: policy.limitDefaults,
      controlPlane: policy.controlPlane,
      pluginRuntime: policy.pluginRuntime,
    };
  }),

  updateInstanceSettings: superAdminProcedure
    .input(
      z
        .object({
          installProfile: installProfileSchema.optional(),
          capabilities: partialInstanceCapabilityPolicySchema.optional(),
          pluginDefaults: instancePluginDefaultsSchema.optional(),
          limitDefaults: instanceLimitDefaultsPatchSchema.optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      if (input.installProfile) {
        await installProfileService.updateInstallProfile(input.installProfile);
      }
      if (input.capabilities) {
        await installProfileService.updateInstanceCapabilityPolicy(input.capabilities);
      }
      if (input.pluginDefaults) {
        await installProfileService.updateInstancePluginDefaults(input.pluginDefaults);
      }
      if (input.limitDefaults) {
        await installProfileService.updateInstanceLimitDefaults(input.limitDefaults);
      }

      const policy = await installProfileService.resolvePolicy();
      return {
        success: true,
        installProfile: policy.installProfile,
        singleProjectMode: policy.singleProjectMode,
        instanceAdminLabel:
          policy.installProfile === "solo" ? "Instance Settings" : "Super Admin",
        capabilities: policy.capabilities,
        pluginDefaults: Object.fromEntries(
          PLUGIN_IDS.map((pluginId) => [
            pluginId,
            {
              enabled: policy.pluginDefaults[pluginId].state === "enabled",
            },
          ]),
        ),
        limitDefaults: policy.limitDefaults,
        controlPlane: policy.controlPlane,
        pluginRuntime: policy.pluginRuntime,
      };
    }),

  listStudioMachines: superAdminProcedure.query(async () => {
    if (!isManagedStudioMachineProvider(studioMachineProvider)) {
      return {
        provider: studioMachineProvider.kind,
        machines: [],
      };
    }

    try {
      const machines = await studioMachineProvider.listStudioMachines();
      return {
        provider: studioMachineProvider.kind,
        machines,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider: studioMachineProvider.kind,
        machines: [],
        error: message,
      };
    }
  }),

  getStudioMachineImageOptions: superAdminProcedure.query(async () => {
    const provider = studioMachineProvider.kind;
    if (!isManagedStudioMachineProvider(studioMachineProvider)) {
      return {
        provider,
        supported: false,
        selectionMode: "unsupported" as const,
        repository: null as string | null,
        imageBase: null as string | null,
        envOverrideVarName: null as string | null,
        envOverrideImage: null as string | null,
        overrideTag: null as string | null,
        desiredImage: null as string | null,
        latestImage: null as string | null,
        images: [] as Array<{ tag: string; kind: "semver" | "dev"; version: string; image: string }>,
        error: null as string | null,
      };
    }

    const managedProvider = studioMachineProvider;
    const imageProvider = managedStudioImageProviderKind() || "fly";
    const repository = normalizeStudioImageRepoConfigured(imageProvider);
    const imageEnvConfig = getStudioImageEnvConfig(imageProvider);
    const envOverrideImage = imageEnvConfig.envOverrideImage;

    let overrideTag: string | null = null;
    try {
      const stored = await getSystemSettingValue(
        SYSTEM_SETTING_KEYS.studioMachineImageTagOverride,
      );
      const trimmed = typeof stored === "string" ? stored.trim() : "";
      overrideTag =
        trimmed.length > 0 && STUDIO_IMAGE_TAG_PATTERN.test(trimmed) ? trimmed : null;
    } catch (err) {
      console.warn(
        `[SuperAdmin] Failed to load studio image override tag: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const fallbackImageBase = fallbackStudioImageBase(repository);
    let imageBase: string | null = fallbackImageBase;
    let images: Array<{ tag: string; kind: "semver" | "dev"; version: string; image: string }> = [];
    let latestImage: string | null = null;
    let ghcrError: string | null = null;

    try {
      const listed = await listStudioImagesFromGhcr({
        repository,
        timeoutMs: 10_000,
        semverLimit: 12,
        devLimit: 25,
      });
      imageBase = listed.imageBase;
      images = listed.images;
      latestImage = listed.images.find((image) => image.kind === "semver")?.image ?? null;
    } catch (err) {
      ghcrError = err instanceof Error ? err.message : String(err);
    }

    const desiredImage =
      envOverrideImage ||
      (overrideTag
        ? `${imageBase ?? fallbackImageBase}:${overrideTag}`
        : await managedProvider.getDesiredImage());
    const desiredImageSource = envOverrideImage
      ? ("env" as const)
      : overrideTag
        ? ("override" as const)
        : latestImage && desiredImage === latestImage
          ? ("ghcr" as const)
          : ("fallback" as const);

    const selectionMode = envOverrideImage
      ? ("env" as const)
      : overrideTag
        ? ("pinned" as const)
        : ("latest" as const);

    return {
      provider,
      supported: true,
      selectionMode,
      repository,
      imageBase: imageBase ?? fallbackImageBase,
      envOverrideVarName: imageEnvConfig.imageEnvVar,
      envOverrideImage,
      overrideTag,
      desiredImage,
      desiredImageSource,
      latestImage,
      images,
      error: ghcrError,
    };
  }),

  setStudioMachineImageOverrideTag: superAdminProcedure
    .input(
      z.object({
        tag: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/, "Invalid image tag")
          .nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isManagedStudioMachineProvider(studioMachineProvider)) {
        return {
          provider: studioMachineProvider.kind,
          updated: false,
          error: "Studio machine provider does not support image management",
        };
      }

      const imageProvider = managedStudioImageProviderKind() || "fly";
      const imageEnvConfig = getStudioImageEnvConfig(imageProvider);
      const envOverrideImage = imageEnvConfig.envOverrideImage;
      if (envOverrideImage) {
        return {
          provider: studioMachineProvider.kind,
          updated: false,
          error:
            `${imageEnvConfig.imageEnvVar} is set in the backend environment; clear it to use the image selector.`,
        };
      }

      const tag = input.tag;
      await setSystemSettingValue(
        SYSTEM_SETTING_KEYS.studioMachineImageTagOverride,
        tag,
      );
      studioMachineProvider.invalidateDesiredImageCache();
      if (!tag) {
        try {
          await studioMachineProvider.getDesiredImage({ forceRefresh: true });
        } catch (err) {
          console.warn(
            `[SuperAdmin] Failed to refresh desired studio image after resetting override: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return {
        provider: studioMachineProvider.kind,
        updated: true,
      };
    }),

  getStudioAgentInstructionsTemplate: superAdminProcedure.query(async () => {
    const stored = await getSystemSettingValue(
      SYSTEM_SETTING_KEYS.studioAgentInstructionsTemplate,
    );
    const template = stored?.trim() || null;
    return {
      source: template ? ("system_setting" as const) : ("default" as const),
      template,
      effectiveTemplate: template || agentInstructionsService.getDefaultTemplate(),
    };
  }),

  setStudioAgentInstructionsTemplate: superAdminProcedure
    .input(
      z.object({
        template: z.string().max(50_000).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const normalized = input.template?.trim() || null;
      await setSystemSettingValue(
        SYSTEM_SETTING_KEYS.studioAgentInstructionsTemplate,
        normalized,
      );
      return { success: true, source: normalized ? "system_setting" : "default" };
    }),

  reconcileStudioMachines: superAdminProcedure.mutation(async () => {
    if (!isManagedStudioMachineProvider(studioMachineProvider)) {
      return {
        provider: studioMachineProvider.kind,
        reconciled: false,
        error: "Studio machine provider does not support reconciliation",
      };
    }

    const result = await studioMachineProvider.reconcileStudioMachines({
      forceRefreshDesiredImage: true,
    });
    return {
      provider: studioMachineProvider.kind,
      reconciled: true,
      result,
    };
  }),

  destroyStudioMachine: superAdminProcedure
    .input(
      z.object({
        machineId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isManagedStudioMachineProvider(studioMachineProvider)) {
        return {
          provider: studioMachineProvider.kind,
          destroyed: false,
          error: "Studio machine provider does not support machine destruction",
        };
      }

      await studioMachineProvider.destroyStudioMachine(input.machineId);
      return {
        provider: studioMachineProvider.kind,
        destroyed: true,
      };
    }),

  lookupUserByEmail: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .query(async ({ input }) => {
      const normalizedEmail = input.email.toLowerCase();
      const existingUser = await db.query.user.findFirst({
        where: eq(userTable.email, normalizedEmail),
        columns: { id: true },
      });
      return { exists: !!existingUser };
    }),

  listOrganizations: superAdminProcedure.query(async () => {
    const rows = await db
      .select({
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        status: organization.status,
        limits: organization.limits,
        githubRepoPrefix: organization.githubRepoPrefix,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        memberCount: sql<number>`count(${organizationMember.userId})`,
      })
      .from(organization)
      .leftJoin(
        organizationMember,
        eq(organizationMember.organizationId, organization.id),
      )
      .groupBy(organization.id);

    return {
      organizations: rows.map((row) => ({
        ...row,
        memberCount: Number(row.memberCount) || 0,
      })),
    };
  }),

  pluginsListAccess: superAdminProcedure
    .input(
      z
        .object({
          pluginId: pluginIdSchema.optional(),
          search: z.string().trim().max(160).optional(),
          state: pluginEntitlementStateSchema.optional(),
          organizationId: organizationIdSchema.optional(),
          limit: z.number().int().min(1).max(500).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const payload = input ?? {};
      const result = await pluginEntitlementService.listProjectAccess({
        pluginId: payload.pluginId ?? "contact_form",
        search: payload.search,
        state: payload.state,
        organizationId: payload.organizationId,
        limit: payload.limit,
        offset: payload.offset,
      });
      return result;
    }),

  pluginsUpsertEntitlement: superAdminProcedure
    .input(
      z
        .object({
          pluginId: pluginIdSchema,
          organizationId: organizationIdSchema,
          scope: pluginEntitlementScopeSchema,
          projectSlug: z.string().trim().min(1).optional(),
          state: pluginEntitlementStateSchema,
          monthlyEventLimit: z.number().int().min(0).nullable().optional(),
          hardStop: z.boolean().optional(),
          turnstileEnabled: z.boolean().optional(),
          notes: z.string().max(1000).optional(),
          ensurePluginWhenEnabled: z.boolean().optional(),
        })
        .refine((data) => (data.scope === "project" ? !!data.projectSlug : true), {
          message: "projectSlug is required for project scope",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingProjectEntitlement =
        input.scope === "project"
          ? await pluginEntitlementService.getProjectEntitlementRow({
              organizationId: input.organizationId,
              projectSlug: input.projectSlug!,
              pluginId: input.pluginId,
            })
          : null;

      let turnstileCredentials:
        | {
            widgetId: string;
            siteKey: string;
            secretKey: string;
          }
        | null = null;

      if (
        input.pluginId === "contact_form" &&
        input.scope === "project" &&
        input.state === "enabled" &&
        input.turnstileEnabled === true
      ) {
        const automationIssue =
          contactFormTurnstileService.getAutomationConfigurationIssue();
        if (automationIssue) {
          throw new Error(automationIssue);
        }

        const prepared = await contactFormTurnstileService.prepareProjectWidgetCredentials({
          organizationId: input.organizationId,
          projectSlug: input.projectSlug!,
          existingWidgetId: existingProjectEntitlement?.turnstileWidgetId ?? null,
          existingSiteKey: existingProjectEntitlement?.turnstileSiteKey ?? null,
          existingSecretKey: existingProjectEntitlement?.turnstileSecretKey ?? null,
        });
        turnstileCredentials = {
          widgetId: prepared.widgetId,
          siteKey: prepared.siteKey,
          secretKey: prepared.secretKey,
        };
      }

      const entitlement = await pluginEntitlementService.upsertEntitlement({
        organizationId: input.organizationId,
        scope: input.scope,
        projectSlug: input.projectSlug,
        pluginId: input.pluginId,
        state: input.state,
        managedBy: "manual_superadmin",
        monthlyEventLimit: input.monthlyEventLimit,
        hardStop: input.hardStop,
        turnstileEnabled: input.turnstileEnabled ?? false,
        turnstileWidgetId:
          input.turnstileEnabled === true ? turnstileCredentials?.widgetId ?? null : null,
        turnstileSiteKey:
          input.turnstileEnabled === true ? turnstileCredentials?.siteKey ?? null : null,
        turnstileSecretKey:
          input.turnstileEnabled === true ? turnstileCredentials?.secretKey ?? null : null,
        notes: input.notes,
        changedByUserId: ctx.session.user.id,
      });

      let ensuredPluginInstanceId: string | null = null;
      if (
        input.scope === "project" &&
        input.state === "enabled" &&
        input.ensurePluginWhenEnabled !== false
      ) {
        if (input.pluginId === "contact_form") {
          const ensured = await projectPluginService.ensureContactFormPlugin({
            organizationId: input.organizationId,
            projectSlug: input.projectSlug!,
          });
          ensuredPluginInstanceId = ensured.instanceId;
        } else if (input.pluginId === "analytics") {
          const ensured = await projectPluginService.ensureAnalyticsPlugin({
            organizationId: input.organizationId,
            projectSlug: input.projectSlug!,
          });
          ensuredPluginInstanceId = ensured.instanceId;
        }
      }

      const isTurnstileDisabledAfterUpsert =
        input.pluginId === "contact_form" &&
        input.scope === "project" &&
        (input.state !== "enabled" || input.turnstileEnabled !== true);
      if (
        isTurnstileDisabledAfterUpsert &&
        existingProjectEntitlement?.turnstileWidgetId
      ) {
        await contactFormTurnstileService.deleteWidget(
          existingProjectEntitlement.turnstileWidgetId,
        );
      }

      return {
        success: true,
        entitlement: {
          id: entitlement.id,
          organizationId: entitlement.organizationId,
          scope: entitlement.scope,
          projectSlug: entitlement.projectSlug,
          pluginId: entitlement.pluginId,
          state: entitlement.state,
          managedBy: entitlement.managedBy,
          monthlyEventLimit: entitlement.monthlyEventLimit,
          hardStop: entitlement.hardStop,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileReady:
            !!entitlement.turnstileSiteKey && !!entitlement.turnstileSecretKey,
          notes: entitlement.notes,
          changedByUserId: entitlement.changedByUserId,
          updatedAt: entitlement.updatedAt,
        },
        ensuredPluginInstanceId,
      };
    }),

  pluginsBulkSetForOrganization: superAdminProcedure
    .input(
      z.object({
        pluginId: pluginIdSchema,
        organizationId: organizationIdSchema,
        state: pluginEntitlementStateSchema,
        monthlyEventLimit: z.number().int().min(0).nullable().optional(),
        hardStop: z.boolean().optional(),
        turnstileEnabled: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entitlement = await pluginEntitlementService.upsertEntitlement({
        organizationId: input.organizationId,
        scope: "organization",
        pluginId: input.pluginId,
        state: input.state,
        managedBy: "manual_superadmin",
        monthlyEventLimit: input.monthlyEventLimit,
        hardStop: input.hardStop,
        turnstileEnabled: input.turnstileEnabled ?? false,
        turnstileWidgetId: null,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
        notes: input.notes,
        changedByUserId: ctx.session.user.id,
      });

      return {
        success: true,
        entitlement: {
          id: entitlement.id,
          organizationId: entitlement.organizationId,
          scope: entitlement.scope,
          projectSlug: entitlement.projectSlug,
          pluginId: entitlement.pluginId,
          state: entitlement.state,
          managedBy: entitlement.managedBy,
          monthlyEventLimit: entitlement.monthlyEventLimit,
          hardStop: entitlement.hardStop,
          turnstileEnabled: entitlement.turnstileEnabled,
          turnstileReady:
            !!entitlement.turnstileSiteKey && !!entitlement.turnstileSecretKey,
          notes: entitlement.notes,
          changedByUserId: entitlement.changedByUserId,
          updatedAt: entitlement.updatedAt,
        },
      };
    }),

  emailDeliverabilityOverview: superAdminProcedure.query(async () => {
    const overview = await emailDeliverabilityService.getOverview();
    const [sesEndpoint, resendEndpoint] = await Promise.all([
      getEmailFeedbackEndpoint("ses"),
      getEmailFeedbackEndpoint("resend"),
    ]);
    return {
      ...overview,
      webhookEndpoints: {
        ses: sesEndpoint,
        resend: resendEndpoint,
      },
    };
  }),

  emailDeliverabilityUpdatePolicy: superAdminProcedure
    .input(emailDeliverabilityPolicyInputSchema)
    .mutation(async ({ input }) => {
      const overview = await emailDeliverabilityService.updatePolicy(input);
      const [sesEndpoint, resendEndpoint] = await Promise.all([
        getEmailFeedbackEndpoint("ses"),
        getEmailFeedbackEndpoint("resend"),
      ]);
      return {
        ...overview,
        webhookEndpoints: {
          ses: sesEndpoint,
          resend: resendEndpoint,
        },
      };
    }),

  emailDeliverabilityUnsuppressRecipient: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input }) => {
      const overview = await emailDeliverabilityService.unsuppressRecipient({
        email: input.email,
      });
      const [sesEndpoint, resendEndpoint] = await Promise.all([
        getEmailFeedbackEndpoint("ses"),
        getEmailFeedbackEndpoint("resend"),
      ]);
      return {
        ...overview,
        webhookEndpoints: {
          ses: sesEndpoint,
          resend: resendEndpoint,
        },
      };
    }),

  getOrganizationUsage: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const instancePolicy = await installProfileService.resolvePolicy();
      const [limits, currentUsage, projectCountRow, org] = await Promise.all([
        limitsService.checkLimits(input.organizationId),
        usageService.getCurrentUsage(input.organizationId),
        db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(projectMeta)
          .where(eq(projectMeta.organizationId, input.organizationId)),
        db.query.organization.findFirst({
          where: eq(organization.id, input.organizationId),
          columns: { limits: true },
        }),
      ]);

      const maxProjectsRaw = instancePolicy.capabilities.orgLimitOverrides
        ? (org?.limits as { maxProjects?: unknown } | null | undefined)?.maxProjects
        : instancePolicy.limitDefaults.maxProjects;
      const maxProjects =
        typeof maxProjectsRaw === "number" && Number.isFinite(maxProjectsRaw) && maxProjectsRaw > 0
          ? Math.floor(maxProjectsRaw)
          : null;
      const projectCount = Number(projectCountRow?.[0]?.count ?? 0);

      return {
        limits,
        currentUsage,
        projectCount,
        maxProjects,
      };
    }),

  createOrganization: superAdminProcedure
    .input(
      z.object({
        slug: organizationSlugSchema,
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      const slugValidation = validateOrganizationSlug(input.slug);
      if (!slugValidation.valid) {
        throw new Error(slugValidation.error || "Invalid organization slug");
      }

      await db.insert(organization).values({
        id: input.slug,
        slug: input.slug,
        name: input.name,
        status: "active",
        limits: {},
        githubRepoPrefix: input.slug,
      });

      await domainService.ensureManagedTenantDomainForOrganization({
        organizationId: input.slug,
        organizationSlug: input.slug,
      });

      return { success: true, organizationId: input.slug };
    }),

  setOrganizationStatus: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        status: z.enum(["active", "suspended"]),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organization)
        .set({ status: input.status })
        .where(eq(organization.id, input.organizationId));
      return { success: true };
    }),

  patchOrganizationLimits: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        limits: limitsPatchSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db.query.organization.findFirst({
        where: eq(organization.id, input.organizationId),
        columns: { limits: true },
      });
      const current =
        existing?.limits && typeof existing.limits === "object" ? existing.limits : {};

      await db
        .update(organization)
        .set({
          limits: {
            ...(current as Record<string, unknown>),
            ...input.limits,
          },
        })
        .where(eq(organization.id, input.organizationId));

      return { success: true };
    }),

  setOrganizationGitHubRepoPrefix: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        githubRepoPrefix: z.string().max(64),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organization)
        .set({ githubRepoPrefix: input.githubRepoPrefix.trim() })
        .where(eq(organization.id, input.organizationId));

      return { success: true };
    }),

  listOrganizationMembers: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const members = await db.query.organizationMember.findMany({
        where: eq(organizationMember.organizationId, input.organizationId),
        with: {
          user: true,
        },
      });

      const userIds = members.map((m) => m.userId);
      const assignments =
        userIds.length > 0
          ? await db.query.projectMember.findMany({
              where: and(
                eq(projectMember.organizationId, input.organizationId),
                inArray(projectMember.userId, userIds),
              ),
              columns: { userId: true, projectSlug: true },
            })
          : [];
      const projectByUserId = new Map(assignments.map((a) => [a.userId, a.projectSlug]));

      return {
        members: members.map((m) => ({
          id: m.id,
          organizationId: m.organizationId,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
          assignedProjectSlug: projectByUserId.get(m.userId) ?? null,
          user: {
            id: m.user.id,
            email: m.user.email,
            name: m.user.name,
            role: m.user.role,
            createdAt: m.user.createdAt,
            updatedAt: m.user.updatedAt,
          },
        })),
      };
    }),

  listOrganizationProjects: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const projects = await db.query.projectMeta.findMany({
        where: eq(projectMeta.organizationId, input.organizationId),
        columns: {
          slug: true,
          title: true,
          updatedAt: true,
        },
        orderBy: (table, { desc }) => [desc(table.updatedAt)],
      });

      return {
        projects: projects.map((p) => ({
          slug: p.slug,
          title: p.title,
          updatedAt: p.updatedAt,
        })),
      };
    }),

  listOrganizationDomains: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const domains = await domainService.listOrganizationDomains(input.organizationId);
      return { domains };
    }),

  addOrganizationDomain: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        domain: z.string().min(1),
        usage: domainUsageSchema,
        type: domainTypeSchema,
        status: domainStatusSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await domainService.addOrganizationDomain({
        organizationId: input.organizationId,
        rawDomain: input.domain,
        usage: input.usage,
        type: input.type,
        status: input.status,
        createdById: ctx.session.user.id,
      });

      return {
        success: true,
        domainId: result.id,
        domain: result.domain,
        created: result.created,
      };
    }),

  setOrganizationDomainStatus: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
        status: domainStatusSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await domainService.setDomainStatus(input.domainId, input.status);
      return { success: true };
    }),

  setOrganizationDomainUsage: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
        usage: domainUsageSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await domainService.setDomainUsage(input.domainId, input.usage);
      return { success: true };
    }),

  startDomainVerification: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const data = await domainService.startDomainVerification(input.domainId);
      return {
        success: true,
        verification: data,
      };
    }),

  checkDomainVerification: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await domainService.checkDomainVerification(input.domainId);
      return {
        success: result.verified,
        status: result.status,
        verification: result.verification,
      };
    }),

  removeOrganizationDomain: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await domainService.removeOrganizationDomain(input.domainId);
      return {
        success: true,
        removed: result.removed,
      };
    }),

  updateOrganizationMemberRole: superAdminProcedure
    .input(
      z
        .object({
          organizationId: organizationIdSchema,
          userId: z.string().min(1),
          role: orgMemberRoleSchema,
          projectSlug: z.string().min(1).optional(),
        })
        .refine((data) => (data.role === "client_editor" ? !!data.projectSlug : true), {
          message: "Project is required for client editor accounts",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new Error("You cannot change your own role");
      }

      await db.transaction(async (tx) => {
        const membership = await tx.query.organizationMember.findFirst({
          where: and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, input.userId),
          ),
          columns: { role: true },
        });

        if (!membership) {
          throw new Error("Member not found");
        }

        if (input.role === "client_editor" && input.projectSlug) {
          const project = await tx.query.projectMeta.findFirst({
            where: and(
              eq(projectMeta.organizationId, input.organizationId),
              eq(projectMeta.slug, input.projectSlug),
            ),
            columns: { slug: true },
          });
          if (!project) {
            throw new Error("Project not found");
          }
        }

        await tx
          .update(organizationMember)
          .set({ role: input.role })
          .where(
            and(
              eq(organizationMember.organizationId, input.organizationId),
              eq(organizationMember.userId, input.userId),
            ),
          );

        const globalRole = getGlobalUserRoleForOrganizationRole(input.role);
        await tx.update(userTable).set({ role: globalRole }).where(eq(userTable.id, input.userId));

        if (input.role === "client_editor" && input.projectSlug) {
          await tx
            .insert(projectMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              userId: input.userId,
              projectSlug: input.projectSlug,
            })
            .onConflictDoUpdate({
              target: [projectMember.organizationId, projectMember.userId],
              set: { projectSlug: input.projectSlug },
            });
        } else {
          await tx
            .delete(projectMember)
            .where(
              and(
                eq(projectMember.organizationId, input.organizationId),
                eq(projectMember.userId, input.userId),
              ),
            );
        }
      });

      return { success: true };
    }),

  removeOrganizationMember: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new Error("You cannot remove yourself");
      }

      const membership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, input.organizationId),
          eq(organizationMember.userId, input.userId),
        ),
        columns: { role: true },
      });

      if (!membership) {
        return { success: true };
      }

      await db
        .delete(projectMember)
        .where(
          and(
            eq(projectMember.organizationId, input.organizationId),
            eq(projectMember.userId, input.userId),
          ),
        );

      await db
        .delete(organizationMember)
        .where(
          and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, input.userId),
          ),
        );

      return { success: true };
    }),

  deleteOrganization: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .mutation(async ({ input }) => {
      if (input.organizationId === "default") {
        throw new Error("The default organization cannot be deleted");
      }
      await db
        .delete(organization)
        .where(eq(organization.id, input.organizationId));
      return { success: true };
    }),

  updateOrganizationName: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, input.organizationId));
      return { success: true };
    }),

  createOrganizationUser: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        email: z.string().email(),
        name: z.string().min(1).max(128).optional(),
        password: z.string().min(8).optional(),
        userRole: z
          .enum(["super_admin", "user"])
          .optional(),
        organizationRole: organizationRoleSchema.optional().default("admin"),
        projectSlug: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const headers = headersFromNode(ctx.req.headers as Record<string, unknown>);
      const normalizedEmail = input.email.toLowerCase();

      if (input.organizationRole === "client_editor" && !input.projectSlug) {
        throw new Error("Project is required for client editor accounts");
      }

      const userRole =
        input.userRole ??
        getGlobalUserRoleForOrganizationRole(input.organizationRole);

      const existingUser = await db.query.user.findFirst({
        where: eq(userTable.email, normalizedEmail),
        columns: { id: true, role: true },
      });

      if (input.organizationRole === "client_editor" && input.projectSlug) {
        const project = await db.query.projectMeta.findFirst({
          where: and(
            eq(projectMeta.organizationId, input.organizationId),
            eq(projectMeta.slug, input.projectSlug),
          ),
          columns: { slug: true },
        });
        if (!project) {
          throw new Error("Project not found");
        }
      }

      if (existingUser) {
        const existingMembership = await db.query.organizationMember.findFirst({
          where: and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, existingUser.id),
          ),
          columns: { id: true },
        });
        if (existingMembership) {
          throw new Error("User is already a member of this organization");
        }

        await db.transaction(async (tx) => {
          if (input.userRole) {
            await tx
              .update(userTable)
              .set({ role: userRole })
              .where(eq(userTable.id, existingUser.id));
          }

          await tx
            .insert(organizationMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              userId: existingUser.id,
              role: input.organizationRole,
            })
            .onConflictDoNothing({
              target: [organizationMember.organizationId, organizationMember.userId],
            });

          if (input.organizationRole === "client_editor" && input.projectSlug) {
            await tx
              .insert(projectMember)
              .values({
                id: crypto.randomUUID(),
                organizationId: input.organizationId,
                userId: existingUser.id,
                projectSlug: input.projectSlug,
              })
              .onConflictDoUpdate({
                target: [projectMember.organizationId, projectMember.userId],
                set: { projectSlug: input.projectSlug },
              });
          }
        });

        return { success: true, userId: existingUser.id, created: false };
      }

      if (!input.name || !input.password) {
        throw new Error("Name and password are required to create a new user");
      }

      const created = await auth.api.createUser({
        headers,
        body: {
          email: normalizedEmail,
          password: input.password,
          name: input.name,
          role: userRole,
        },
      });

      const parsedCreateUser = authCreateUserResponseSchema.safeParse(created);
      if (!parsedCreateUser.success) {
        throw new Error("Failed to create user");
      }
      const createdUserId = parsedCreateUser.data.user.id;

      await db.transaction(async (tx) => {
        await tx
          .insert(organizationMember)
          .values({
            id: crypto.randomUUID(),
            organizationId: input.organizationId,
            userId: createdUserId,
            role: input.organizationRole,
          })
          .onConflictDoNothing({
            target: [organizationMember.organizationId, organizationMember.userId],
          });

        if (input.organizationRole === "client_editor" && input.projectSlug) {
          await tx
            .insert(projectMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              userId: createdUserId,
              projectSlug: input.projectSlug,
            })
            .onConflictDoUpdate({
              target: [projectMember.organizationId, projectMember.userId],
              set: { projectSlug: input.projectSlug },
            });
        }
      });

      return { success: true, userId: createdUserId, created: true };
    }),
});
