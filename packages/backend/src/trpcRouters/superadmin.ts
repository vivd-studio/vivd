import { TRPCError } from "@trpc/server";
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
import {
  cleanupPluginProjectEntitlementFields,
  preparePluginProjectEntitlementFields,
} from "../services/plugins/integrationHooks";
import { getEmailFeedbackEndpoint } from "../services/plugins/contactForm/publicApi";
import { emailDeliverabilityService } from "../services/email/deliverability";
import {
  emailTemplateBrandingPatchInputSchema,
  emailTemplateBrandingService,
} from "../services/email/templateBranding";
import {
  PLUGIN_IDS,
  type PluginId,
  listPluginCatalogEntries,
} from "../services/plugins/catalog";
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
import {
  instanceNetworkSettingsService,
  instanceTlsModeSchema,
} from "../services/system/InstanceNetworkSettingsService";
import { instanceSoftwareService } from "../services/system/InstanceSoftwareService";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService";
import {
  listStudioImagesFromGhcr,
  normalizeGhcrRepository,
} from "../services/studioMachines/fly/ghcr";
import {
  organizationIdSchema,
  organizationSlugSchema,
} from "../lib/organizationIdentifiers";
import { reloadCaddyConfig } from "../services/system/CaddyAdminService";
import { publishService } from "../services/publish/PublishService";
import type { StudioMachineSummary } from "../services/studioMachines/types";

const STUDIO_MACHINE_IMAGE_SEMVER_LIMIT = 12;
const STUDIO_MACHINE_IMAGE_DEV_LIMIT = 100;

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

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
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
const studioMachineSummarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  state: z.string().nullable(),
  region: z.string().nullable(),
  cpuKind: z.string().nullable(),
  cpus: z.number().nullable(),
  memoryMb: z.number().nullable(),
  organizationId: z.string(),
  projectSlug: z.string(),
  version: z.number(),
  externalPort: z.number().nullable(),
  routePath: z.string().nullable(),
  url: z.string().nullable(),
  runtimeUrl: z.string().nullable(),
  compatibilityUrl: z.string().nullable(),
  image: z.string().nullable(),
  desiredImage: z.string(),
  imageOutdated: z.boolean(),
  imageStatus: z.enum(["ok", "outdated", "unknown"]).optional(),
  imageId: z.string().nullable().optional(),
  imageDigest: z.string().nullable().optional(),
  imageVersion: z.string().nullable().optional(),
  imageRevision: z.string().nullable().optional(),
  desiredImageId: z.string().nullable().optional(),
  desiredImageDigest: z.string().nullable().optional(),
  desiredImageVersion: z.string().nullable().optional(),
  desiredImageRevision: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
const listStudioMachinesOutputSchema = z.object({
  provider: z.string(),
  machines: z.array(studioMachineSummarySchema),
  error: z.string().optional(),
});

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

const instanceNetworkSettingsPatchSchema = z
  .object({
    publicHost: z.string().trim().min(1).max(255).nullable().optional(),
    tlsMode: instanceTlsModeSchema.nullable().optional(),
    acmeEmail: z.string().trim().email().nullable().optional(),
  })
  .strict();

const SOLO_INSTALL_PROFILE_LOCK_MESSAGE =
  "Install profile changes are not available from the UI on solo installs.";
const SOLO_CAPABILITIES_LOCK_MESSAGE =
  "Advanced tenancy capabilities are not editable on solo installs.";

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

async function buildEmailOverviewPayload() {
  const [overview, branding, sesEndpoint, resendEndpoint] = await Promise.all([
    emailDeliverabilityService.getOverview(),
    emailTemplateBrandingService.getResolvedBranding(),
    getEmailFeedbackEndpoint("ses"),
    getEmailFeedbackEndpoint("resend"),
  ]);

  return {
    ...overview,
    templateBranding: branding,
    webhookEndpoints: {
      ses: sesEndpoint,
      resend: resendEndpoint,
    },
  };
}

export const superAdminRouter = router({
  getInstanceSettings: superAdminProcedure.query(async () => {
    const policy = await installProfileService.resolvePolicy();
    const network = instanceNetworkSettingsService.getResolvedSettings();
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
      pluginCatalog: listPluginCatalogEntries(),
      limitDefaults: policy.limitDefaults,
      controlPlane: policy.controlPlane,
      pluginRuntime: policy.pluginRuntime,
      network: {
        publicHost: network.publicHost,
        publicOrigin: network.publicOrigin,
        tlsMode: network.tlsMode,
        acmeEmail: network.acmeEmail,
        sources: network.sources,
        deploymentManaged: network.deploymentManaged,
      },
    };
  }),

  getInstanceSoftware: superAdminProcedure.query(async () => {
    const policy = await installProfileService.resolvePolicy();
    return await instanceSoftwareService.getStatus(policy.installProfile);
  }),

  updateInstanceSettings: superAdminProcedure
    .input(
      z
        .object({
          installProfile: installProfileSchema.optional(),
          capabilities: partialInstanceCapabilityPolicySchema.optional(),
          pluginDefaults: instancePluginDefaultsSchema.optional(),
          limitDefaults: instanceLimitDefaultsPatchSchema.optional(),
          network: instanceNetworkSettingsPatchSchema.optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const currentPolicy = await installProfileService.resolvePolicy();

      if (currentPolicy.installProfile === "solo" && input.installProfile) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: SOLO_INSTALL_PROFILE_LOCK_MESSAGE,
        });
      }

      if (currentPolicy.installProfile === "solo" && input.capabilities) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: SOLO_CAPABILITIES_LOCK_MESSAGE,
        });
      }

      const targetInstallProfile = input.installProfile ?? currentPolicy.installProfile;

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
      if (input.network) {
        if (targetInstallProfile !== "solo") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Instance network settings are currently UI-managed only for solo installs.",
          });
        }
        await instanceNetworkSettingsService.updateStoredSettings(input.network);
        const caddyfileChanged =
          await instanceNetworkSettingsService.syncSelfHostedCaddyConfig();
        if (caddyfileChanged) {
          await reloadCaddyConfig();
        }
        await publishService.syncGeneratedCaddyConfigs();
      }

      const policy = await installProfileService.resolvePolicy();
      const network = instanceNetworkSettingsService.getResolvedSettings();
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
        pluginCatalog: listPluginCatalogEntries(),
        limitDefaults: policy.limitDefaults,
        controlPlane: policy.controlPlane,
        pluginRuntime: policy.pluginRuntime,
        network: {
          publicHost: network.publicHost,
          publicOrigin: network.publicOrigin,
          tlsMode: network.tlsMode,
          acmeEmail: network.acmeEmail,
          sources: network.sources,
          deploymentManaged: network.deploymentManaged,
        },
      };
    }),

  startInstanceSoftwareUpdate: superAdminProcedure.mutation(async () => {
    const policy = await installProfileService.resolvePolicy();
    if (policy.installProfile !== "solo") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Managed updates are available only for solo self-host installs.",
      });
    }

    const software = await instanceSoftwareService.getStatus(policy.installProfile);
    if (!software.managedUpdate.enabled) {
      return {
        started: false as const,
        error:
          software.managedUpdate.reason ||
          "Managed self-host updates are not configured for this installation.",
        targetTag: null,
      };
    }

    if (!software.latestTag) {
      return {
        started: false as const,
        error: "Could not resolve the latest release tag for this installation.",
        targetTag: null,
      };
    }

    if (software.releaseStatus === "current") {
      return {
        started: false as const,
        error: "This installation is already on the latest known release.",
        targetTag: software.latestTag,
      };
    }

    return await instanceSoftwareService.startManagedUpdate({
      installProfile: policy.installProfile,
      targetTag: software.latestTag,
    });
  }),

  listStudioMachines: superAdminProcedure.output(listStudioMachinesOutputSchema).query(async (): Promise<
    | {
        provider: string;
        machines: StudioMachineSummary[];
      }
    | {
        provider: string;
        machines: StudioMachineSummary[];
        error: string;
      }
  > => {
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
        semverLimit: STUDIO_MACHINE_IMAGE_SEMVER_LIMIT,
        devLimit: STUDIO_MACHINE_IMAGE_DEV_LIMIT,
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

  reconcileStudioMachine: superAdminProcedure
    .input(
      z.object({
        machineId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isManagedStudioMachineProvider(studioMachineProvider)) {
        return {
          provider: studioMachineProvider.kind,
          reconciled: false,
          error: "Studio machine provider does not support targeted reconciliation",
        };
      }

      const result = await studioMachineProvider.reconcileStudioMachine(input.machineId, {
        forceRefreshDesiredImage: true,
      });
      return {
        provider: studioMachineProvider.kind,
        reconciled: true,
        result,
      };
    }),

  parkStudioMachine: superAdminProcedure
    .input(
      z.object({
        machineId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isManagedStudioMachineProvider(studioMachineProvider)) {
        return {
          provider: studioMachineProvider.kind,
          parked: false,
          error: "Studio machine provider does not support machine parking",
        };
      }

      const state = await studioMachineProvider.parkStudioMachine(input.machineId);
      return {
        provider: studioMachineProvider.kind,
        parked: true,
        state,
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
      const selectedCatalog = (
        payload.pluginId
          ? listPluginCatalogEntries().filter(
              (plugin) => plugin.pluginId === payload.pluginId,
            )
          : listPluginCatalogEntries()
      ).sort((left, right) => left.sortOrder - right.sortOrder);

      const accessByPlugin = await Promise.all(
        selectedCatalog.map(async (plugin) => ({
          plugin,
          result: await pluginEntitlementService.listProjectAccess({
            pluginId: plugin.pluginId,
            search: payload.search,
            state: payload.state,
            organizationId: payload.organizationId,
            limit: 500,
            offset: 0,
          }),
        })),
      );

      const projectMap = new Map<
        string,
        {
          organizationId: string;
          organizationSlug: string;
          organizationName: string;
          projectSlug: string;
          projectTitle: string;
          isDeployed: boolean;
          deployedDomain: string | null;
          plugins: Map<
            string,
            {
              organizationId: string;
              pluginId: PluginId;
              projectSlug: string;
              catalog: (typeof selectedCatalog)[number];
              effectiveScope: "instance" | "organization" | "project" | "none";
              state: "disabled" | "enabled" | "suspended";
              managedBy: "manual_superadmin" | "plan" | "self_serve";
              monthlyEventLimit: number | null;
              hardStop: boolean;
              turnstileEnabled: boolean;
              turnstileReady: boolean;
              usageThisMonth: number;
              projectPluginStatus: "enabled" | "disabled" | null;
              updatedAt: string | null;
            }
          >;
        }
      >();

      for (const { plugin, result } of accessByPlugin) {
        for (const row of result.rows) {
          const key = `${row.organizationId}:${row.projectSlug}`;
          const existing = projectMap.get(key);
          if (existing) {
            existing.plugins.set(plugin.pluginId, {
              organizationId: row.organizationId,
              pluginId: plugin.pluginId,
              projectSlug: row.projectSlug,
              catalog: plugin,
              effectiveScope: row.effectiveScope,
              state: row.state,
              managedBy: row.managedBy,
              monthlyEventLimit: row.monthlyEventLimit,
              hardStop: row.hardStop,
              turnstileEnabled: row.turnstileEnabled,
              turnstileReady: row.turnstileReady,
              usageThisMonth: row.usageThisMonth,
              projectPluginStatus: row.projectPluginStatus,
              updatedAt: toIsoString(row.updatedAt),
            });
            continue;
          }

          projectMap.set(key, {
            organizationId: row.organizationId,
            organizationSlug: row.organizationSlug,
            organizationName: row.organizationName,
            projectSlug: row.projectSlug,
            projectTitle: row.projectTitle,
            isDeployed: row.isDeployed,
            deployedDomain: row.deployedDomain,
            plugins: new Map([
              [
                plugin.pluginId,
                {
                  organizationId: row.organizationId,
                  pluginId: plugin.pluginId,
                  projectSlug: row.projectSlug,
                  catalog: plugin,
                  effectiveScope: row.effectiveScope,
                  state: row.state,
                  managedBy: row.managedBy,
                  monthlyEventLimit: row.monthlyEventLimit,
                  hardStop: row.hardStop,
                  turnstileEnabled: row.turnstileEnabled,
                  turnstileReady: row.turnstileReady,
                  usageThisMonth: row.usageThisMonth,
                  projectPluginStatus: row.projectPluginStatus,
                  updatedAt: toIsoString(row.updatedAt),
                },
              ],
            ]),
          });
        }
      }

      const groupedRows = Array.from(projectMap.values())
        .map((project) => {
          const plugins = selectedCatalog.map((plugin) => {
            return (
              project.plugins.get(plugin.pluginId) ?? {
                organizationId: project.organizationId,
                pluginId: plugin.pluginId,
                projectSlug: project.projectSlug,
                catalog: plugin,
                effectiveScope: "none" as const,
                state: "disabled" as const,
                managedBy: "manual_superadmin" as const,
                monthlyEventLimit: null,
                hardStop: true,
                turnstileEnabled: false,
                turnstileReady: false,
                usageThisMonth: 0,
                projectPluginStatus: null,
                updatedAt: null,
              }
            );
          });
          const updatedAt = plugins.reduce<string | null>((latest, plugin) => {
            if (!plugin.updatedAt) return latest;
            if (!latest) return plugin.updatedAt;
            return plugin.updatedAt > latest ? plugin.updatedAt : latest;
          }, null);

          return {
            organizationId: project.organizationId,
            organizationSlug: project.organizationSlug,
            organizationName: project.organizationName,
            projectSlug: project.projectSlug,
            projectTitle: project.projectTitle,
            isDeployed: project.isDeployed,
            deployedDomain: project.deployedDomain,
            plugins,
            updatedAt,
          };
        })
        .sort((left, right) => {
          const orgOrder = left.organizationName.localeCompare(right.organizationName);
          if (orgOrder !== 0) return orgOrder;
          return left.projectSlug.localeCompare(right.projectSlug);
        });

      const offset = Math.max(0, payload.offset ?? 0);
      const limit = Math.max(1, Math.min(500, payload.limit ?? 100));

      return {
        pluginCatalog: selectedCatalog,
        rows: groupedRows.slice(offset, offset + limit),
        total: groupedRows.length,
      };
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

      const preparedEntitlementFields =
        input.scope === "project"
          ? await preparePluginProjectEntitlementFields({
              pluginId: input.pluginId,
              organizationId: input.organizationId,
              projectSlug: input.projectSlug!,
              state: input.state,
              turnstileEnabled: input.turnstileEnabled ?? false,
              existingProjectEntitlement: existingProjectEntitlement
                ? {
                    turnstileWidgetId:
                      existingProjectEntitlement.turnstileWidgetId ?? null,
                    turnstileSiteKey:
                      existingProjectEntitlement.turnstileSiteKey ?? null,
                    turnstileSecretKey:
                      existingProjectEntitlement.turnstileSecretKey ?? null,
                  }
                : null,
            })
          : {
              turnstileEnabled: input.turnstileEnabled ?? false,
              turnstileWidgetId: null,
              turnstileSiteKey: null,
              turnstileSecretKey: null,
            };

      const entitlement = await pluginEntitlementService.upsertEntitlement({
        organizationId: input.organizationId,
        scope: input.scope,
        projectSlug: input.projectSlug,
        pluginId: input.pluginId,
        state: input.state,
        managedBy: "manual_superadmin",
        monthlyEventLimit: input.monthlyEventLimit,
        hardStop: input.hardStop,
        turnstileEnabled: preparedEntitlementFields.turnstileEnabled,
        turnstileWidgetId: preparedEntitlementFields.turnstileWidgetId,
        turnstileSiteKey: preparedEntitlementFields.turnstileSiteKey,
        turnstileSecretKey: preparedEntitlementFields.turnstileSecretKey,
        notes: input.notes,
        changedByUserId: ctx.session.user.id,
      });

      let ensuredPluginInstanceId: string | null = null;
      if (
        input.scope === "project" &&
        input.state === "enabled" &&
        input.ensurePluginWhenEnabled !== false
      ) {
        const ensured = await projectPluginService.ensurePluginInstance({
          organizationId: input.organizationId,
          projectSlug: input.projectSlug!,
          pluginId: input.pluginId,
        });
        ensuredPluginInstanceId = ensured.instanceId;
      }

      if (input.scope === "project") {
        await cleanupPluginProjectEntitlementFields({
          pluginId: input.pluginId,
          state: input.state,
          turnstileEnabled: input.turnstileEnabled ?? false,
          existingProjectEntitlement: existingProjectEntitlement
            ? {
                turnstileWidgetId: existingProjectEntitlement.turnstileWidgetId ?? null,
                turnstileSiteKey: existingProjectEntitlement.turnstileSiteKey ?? null,
                turnstileSecretKey: existingProjectEntitlement.turnstileSecretKey ?? null,
              }
            : null,
        });
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

  emailDeliverabilityOverview: superAdminProcedure.query(async () =>
    buildEmailOverviewPayload(),
  ),

  emailDeliverabilityUpdatePolicy: superAdminProcedure
    .input(emailDeliverabilityPolicyInputSchema)
    .mutation(async ({ input }) => {
      await emailDeliverabilityService.updatePolicy(input);
      return buildEmailOverviewPayload();
    }),

  emailDeliverabilityUnsuppressRecipient: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input }) => {
      await emailDeliverabilityService.unsuppressRecipient({
        email: input.email,
      });
      return buildEmailOverviewPayload();
    }),

  emailTemplateBrandingUpdate: superAdminProcedure
    .input(emailTemplateBrandingPatchInputSchema)
    .mutation(async ({ input }) => {
      await emailTemplateBrandingService.updateBranding(input);
      return buildEmailOverviewPayload();
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
