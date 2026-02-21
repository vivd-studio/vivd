import type { FlyMachine } from "./types";
import { getMachineMetadata } from "./machineModel";
import { parseIntOrNull } from "./utils";

export type FlyStudioIdentity = {
  organizationId: string;
  projectSlug: string;
  version: number;
};

export function findMachine(
  machines: FlyMachine[],
  organizationId: string,
  projectSlug: string,
  version: number,
): FlyMachine | null {
  const v = String(version);
  const expectedOrg = organizationId.trim() || "default";
  return (
    machines.find((machine) => {
      const metadata = getMachineMetadata(machine);
      const machineOrg = (
        metadata?.vivd_organization_id ||
        machine.config?.env?.VIVD_TENANT_ID ||
        "default"
      ).trim() || "default";
      const machineSlug =
        metadata?.vivd_project_slug || machine.config?.env?.VIVD_PROJECT_SLUG;
      const machineVersion =
        metadata?.vivd_project_version || machine.config?.env?.VIVD_PROJECT_VERSION;
      return (
        machineOrg === expectedOrg &&
        machineSlug === projectSlug &&
        machineVersion === v
      );
    }) || null
  );
}

export function findMachineByName(
  machines: FlyMachine[],
  machineName: string,
): FlyMachine | null {
  return machines.find((machine) => machine.name === machineName) || null;
}

export function getStudioIdentityFromMachine(machine: FlyMachine): FlyStudioIdentity | null {
  const metadata = getMachineMetadata(machine);
  const organizationId = (
    metadata?.vivd_organization_id ||
    machine.config?.env?.VIVD_TENANT_ID ||
    "default"
  ).trim() || "default";
  const projectSlug =
    metadata?.vivd_project_slug || machine.config?.env?.VIVD_PROJECT_SLUG;
  const version = parseIntOrNull(
    metadata?.vivd_project_version || machine.config?.env?.VIVD_PROJECT_VERSION,
  );
  if (!projectSlug || !version) return null;
  return { organizationId, projectSlug, version };
}

export function getStudioKeyFromMachine(
  machine: FlyMachine,
  keyFor: (organizationId: string, projectSlug: string, version: number) => string,
): string | null {
  const identity = getStudioIdentityFromMachine(machine);
  if (!identity) return null;
  return keyFor(identity.organizationId, identity.projectSlug, identity.version);
}

export function getMachineCreatedAtMs(machine: FlyMachine): number | null {
  const raw = machine.created_at || getMachineMetadata(machine)?.vivd_created_at;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function getMachineExternalPort(machine: FlyMachine): number | null {
  const fromMetadata = parseIntOrNull(getMachineMetadata(machine)?.vivd_external_port);
  if (fromMetadata) return fromMetadata;

  const ports = machine.config?.services?.flatMap((s) => s.ports ?? []) ?? [];
  const port = ports.map((p) => p.port).find((p) => typeof p === "number");
  return typeof port === "number" ? port : null;
}

export function getPublicUrlForPort(options: {
  protocol: string;
  host: string;
  port: number;
}): string {
  const needsPort =
    !(options.protocol === "https" && options.port === 443) &&
    !(options.protocol === "http" && options.port === 80);
  return `${options.protocol}://${options.host}${needsPort ? `:${options.port}` : ""}`;
}
