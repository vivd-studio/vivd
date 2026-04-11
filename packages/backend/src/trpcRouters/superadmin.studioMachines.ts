import { z } from "zod";
import { superAdminProcedure } from "../trpc";
import { studioMachineProvider } from "../services/studioMachines";
import { isManagedStudioMachineProvider } from "../services/studioMachines/types";
import {
  getSystemSettingValue,
  setSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "../services/system/SystemSettingsService";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService";
import {
  listStudioImagesFromGhcr,
  normalizeGhcrRepository,
} from "../services/studioMachines/fly/ghcr";
import type { StudioMachineSummary } from "../services/studioMachines/types";

const STUDIO_MACHINE_IMAGE_SEMVER_LIMIT = 12;
const STUDIO_MACHINE_IMAGE_DEV_LIMIT = 100;
const STUDIO_IMAGE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

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

export const studioMachinesSuperAdminProcedures = {
  listStudioMachines: superAdminProcedure
    .output(listStudioMachinesOutputSchema)
    .query(
      async (): Promise<
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
      },
    ),

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
        images: [] as Array<{
          tag: string;
          kind: "semver" | "dev";
          version: string;
          image: string;
        }>,
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
    let images: Array<{
      tag: string;
      kind: "semver" | "dev";
      version: string;
      image: string;
    }> = [];
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
};
