import type { ManagedStudioMachineProvider } from "./types";

export type ManagedStudioMachineDeleteCleanupResult = {
  destroyed: number;
  warnings: string[];
};

export async function cleanupManagedStudioMachinesForDeletedProject(options: {
  provider: ManagedStudioMachineProvider;
  organizationId: string;
  slug: string;
  version?: number;
  logPrefix: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}): Promise<ManagedStudioMachineDeleteCleanupResult> {
  const log = options.log || console.log;
  const warn = options.warn || console.warn;

  let machines;
  try {
    machines = await options.provider.listStudioMachines();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const warning = `[${options.logPrefix}] Failed to list managed studio machines for ${options.slug}${options.version != null ? `/v${options.version}` : ""}: ${message}`;
    warn(warning);
    return {
      destroyed: 0,
      warnings: [warning],
    };
  }

  const matchingMachines = machines.filter(
    (machine) =>
      machine.organizationId === options.organizationId &&
      machine.projectSlug === options.slug &&
      (options.version == null || machine.version === options.version),
  );

  const warnings: string[] = [];
  let destroyed = 0;
  for (const machine of matchingMachines) {
    try {
      await options.provider.destroyStudioMachine(machine.id);
      destroyed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warning = `[${options.logPrefix}] Failed to destroy studio machine ${machine.id} for ${options.slug}/v${machine.version}: ${message}`;
      warnings.push(warning);
      warn(warning);
    }
  }

  if (destroyed > 0) {
    log(
      `[${options.logPrefix}] Destroyed ${destroyed} managed studio machine(s) for: ${options.slug}${options.version != null ? `/v${options.version}` : ""}`,
    );
  }

  return {
    destroyed,
    warnings,
  };
}
