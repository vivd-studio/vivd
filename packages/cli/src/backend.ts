import {
  createConnectedStudioBackendClient,
  getConnectedStudioBackendClientConfig,
  type ConnectedStudioBackendClient,
  type ConnectedStudioBackendClientConfig,
} from "@vivd/shared/studio";
import type { CliFlags } from "./args.js";

export interface CliRuntime {
  config: ConnectedStudioBackendClientConfig;
  client: ConnectedStudioBackendClient;
  projectSlug: string | null;
  projectVersion: number | null;
}

export function resolveCliRuntime(
  env: NodeJS.ProcessEnv = process.env,
  flags: Pick<CliFlags, "slug" | "version"> = {},
): CliRuntime | null {
  const baseConfig = getConnectedStudioBackendClientConfig(env);
  if (!baseConfig) return null;

  const projectSlug = (flags.slug ?? baseConfig.projectSlug ?? "").trim() || null;
  const projectVersion = flags.version ?? baseConfig.projectVersion ?? null;
  const config = {
    ...baseConfig,
    projectSlug: projectSlug ?? undefined,
    projectVersion,
  };

  return {
    config,
    client: createConnectedStudioBackendClient(config),
    projectSlug,
    projectVersion,
  };
}
