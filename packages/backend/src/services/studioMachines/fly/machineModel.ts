import crypto from "node:crypto";
import type {
  FlyMachine,
  FlyMachineConfig,
  FlyMachinePort,
  FlyMachineService,
} from "./types";
import { isRecordOfStrings } from "./utils";

export const STUDIO_ACCESS_TOKEN_ENV_KEY = "STUDIO_ACCESS_TOKEN";
export const STUDIO_ACCESS_TOKEN_METADATA_KEY = "vivd_studio_access_token";

export type DesiredFlyGuest = {
  cpu_kind: "shared" | "performance";
  cpus: number;
  memory_mb: number;
};

export type MachineReconcileNeeds = {
  image: boolean;
  services: boolean;
  guest: boolean;
  accessToken: boolean;
  env: boolean;
};

export function trimToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function getMachineMetadataValue(machine: FlyMachine, key: string): string | null {
  const read = (record: unknown): string | null => {
    if (!record || typeof record !== "object") return null;
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    return null;
  };

  return read(machine.config?.metadata) || read(machine.metadata);
}

export function getMachineMetadata(machine: FlyMachine): Record<string, string> | null {
  const fromConfig = machine.config?.metadata;
  if (isRecordOfStrings(fromConfig)) return fromConfig;
  const legacy = machine.metadata;
  if (isRecordOfStrings(legacy)) return legacy;
  return null;
}

export function getConfiguredStudioImage(
  machine: FlyMachine,
  desiredImage?: string,
): string | null {
  const metadataImage = trimToken(getMachineMetadataValue(machine, "vivd_image"));
  if (metadataImage) return metadataImage;

  const configImage = trimToken(
    typeof machine.config?.image === "string" ? machine.config.image : null,
  );
  if (!configImage) return null;

  // Fly may return tag+digest refs (e.g. "...:v1.2.3@sha256:..."). The digest doesn't
  // represent drift for our purposes when we're pinning by tag.
  const digestIndex = !desiredImage?.includes("@") ? configImage.indexOf("@") : -1;
  if (digestIndex !== -1) {
    return trimToken(configImage.slice(0, digestIndex));
  }

  return configImage;
}

export function needsGuestUpdate(
  guest: FlyMachineConfig["guest"] | undefined,
  desiredGuest: DesiredFlyGuest,
): boolean {
  if (!guest) return true;
  return (
    guest.cpu_kind !== desiredGuest.cpu_kind ||
    guest.cpus !== desiredGuest.cpus ||
    guest.memory_mb !== desiredGuest.memory_mb
  );
}

export function resolveMachineReconcileState(options: {
  machine: FlyMachine;
  desiredImage: string;
  desiredGuest: DesiredFlyGuest;
  preferredAccessToken?: string | null;
  desiredEnvSubset?: Record<string, string>;
  generateStudioAccessToken: () => string;
}): { accessToken: string; needs: MachineReconcileNeeds } {
  const metadataToken = trimToken(
    getMachineMetadataValue(options.machine, STUDIO_ACCESS_TOKEN_METADATA_KEY),
  );
  const envToken = trimToken(
    options.machine.config?.env?.[STUDIO_ACCESS_TOKEN_ENV_KEY],
  );
  const preferredToken = trimToken(options.preferredAccessToken);

  const configuredImage = getConfiguredStudioImage(options.machine, options.desiredImage);
  const needsImageUpdate = configuredImage !== options.desiredImage;

  const needsServiceUpdate =
    options.machine.config?.services?.some((service) => {
      const needsAutostart = service.autostart !== true;
      const needsAutostop = service.autostop !== "suspend";
      return needsAutostart || needsAutostop;
    }) ?? true;

  const needs: MachineReconcileNeeds = {
    image: needsImageUpdate,
    services: needsServiceUpdate,
    guest: needsGuestUpdate(options.machine.config?.guest, options.desiredGuest),
    accessToken: !metadataToken || !envToken || metadataToken !== envToken,
    env: Object.entries(options.desiredEnvSubset || {}).some(([key, value]) => {
      if (typeof value !== "string") return false;
      return trimToken(options.machine.config?.env?.[key]) !== trimToken(value);
    }),
  };

  return {
    accessToken:
      metadataToken ||
      envToken ||
      preferredToken ||
      options.generateStudioAccessToken(),
    needs,
  };
}

export function hasMachineDrift(needs: MachineReconcileNeeds): boolean {
  return (
    needs.image ||
    needs.services ||
    needs.guest ||
    needs.accessToken ||
    needs.env
  );
}

export function getMachineDriftLabels(needs: MachineReconcileNeeds): string[] {
  const labels: string[] = [];
  if (needs.image) labels.push("image");
  if (needs.services) labels.push("services");
  if (needs.guest) labels.push("guest");
  if (needs.accessToken) labels.push("accessToken");
  if (needs.env) labels.push("env");
  return labels;
}

export function shouldStopSuspendedBeforeReconcile(
  state: string | undefined,
  needs: MachineReconcileNeeds,
): boolean {
  return state === "suspended" && hasMachineDrift(needs);
}

export function resolveStudioIdFromMachine(
  machine: FlyMachine,
  fallback?: string | null,
): string {
  return (
    getMachineMetadata(machine)?.vivd_studio_id ||
    machine.config?.env?.STUDIO_ID ||
    trimToken(fallback) ||
    crypto.randomUUID()
  );
}

export function withAccessTokenEnv(
  env: Record<string, string> | undefined,
  accessToken: string,
): Record<string, string> {
  return {
    ...(env || {}),
    [STUDIO_ACCESS_TOKEN_ENV_KEY]: accessToken,
  };
}

export function buildReconciledMetadata(options: {
  machine: FlyMachine;
  organizationId: string;
  projectSlug: string;
  version: number;
  port: number;
  studioId: string;
  desiredImage: string;
  accessToken: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  return {
    ...(getMachineMetadata(options.machine) || {}),
    vivd_organization_id: options.organizationId,
    vivd_project_slug: options.projectSlug,
    vivd_project_version: String(options.version),
    vivd_external_port: String(options.port),
    vivd_studio_id: options.studioId,
    vivd_image: options.desiredImage,
    [STUDIO_ACCESS_TOKEN_METADATA_KEY]: options.accessToken,
    ...(options.extra || {}),
  };
}

export function buildReconciledMachineConfig(options: {
  machine: FlyMachine;
  port: number;
  desiredImage: string;
  accessToken: string;
  needs: MachineReconcileNeeds;
  metadata: Record<string, string>;
  desiredGuest: DesiredFlyGuest;
  normalizeServicesForVivd: (
    services: FlyMachineService[] | undefined,
    externalPort: number,
  ) => FlyMachineService[];
  fullEnv?: Record<string, string>;
}): FlyMachineConfig {
  return {
    ...(options.machine.config || {}),
    ...(options.needs.image ? { image: options.desiredImage } : {}),
    ...(options.needs.services
      ? {
          services: options.normalizeServicesForVivd(
            options.machine.config?.services,
            options.port,
          ),
        }
      : {}),
    ...(options.needs.guest ? { guest: options.desiredGuest } : {}),
    ...(options.needs.accessToken || options.needs.env
      ? {
          env:
            options.fullEnv ||
            withAccessTokenEnv(options.machine.config?.env, options.accessToken),
        }
      : {}),
    metadata: options.metadata,
  };
}

export function normalizeServicesForVivd(
  services: FlyMachineService[] | undefined,
  externalPort: number,
): FlyMachineService[] {
  const normalized = (services && services.length > 0 ? services : [{}]).map(
    (service) => {
      const ports = (service.ports && service.ports.length > 0
        ? service.ports
        : [{ port: externalPort, handlers: ["tls", "http"] }]) as FlyMachinePort[];

      // Ensure the external port we expect is present.
      const hasExternalPort = ports.some((p) => p.port === externalPort);
      if (!hasExternalPort) {
        ports.push({ port: externalPort, handlers: ["tls", "http"] });
      }

      return {
        ...service,
        protocol: service.protocol || "tcp",
        internal_port: service.internal_port || 3100,
        ports,
        autostop: "suspend",
        autostart: true,
        min_machines_running: 0,
      };
    },
  );

  return normalized;
}

export function getStudioAccessTokenFromMachine(machine: FlyMachine): string | null {
  const metadataToken = getMachineMetadataValue(machine, STUDIO_ACCESS_TOKEN_METADATA_KEY);
  if (typeof metadataToken === "string" && metadataToken.trim()) {
    return metadataToken.trim();
  }

  const envToken = machine.config?.env?.[STUDIO_ACCESS_TOKEN_ENV_KEY];
  if (typeof envToken === "string" && envToken.trim()) {
    return envToken.trim();
  }

  return null;
}
