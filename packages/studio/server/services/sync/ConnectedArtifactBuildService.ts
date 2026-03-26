import { isConnectedMode } from "@vivd/shared";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

export type ConnectedArtifactBuildKind = "preview" | "published";

type BackendArtifactBuildResponse = {
  enabled: boolean;
  accepted: boolean;
  deduped: boolean;
  status: "queued" | "building" | "ready" | "error" | "disabled";
};

export type ConnectedArtifactBuildRequestResult =
  | {
      requested: true;
      deduped: boolean;
      status: "queued" | "building" | "ready" | "error";
    }
  | {
      requested: false;
      reason:
        | "not_connected"
        | "disabled"
        | "missing_backend_auth"
        | "backend_disabled";
    };

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function isConnectedArtifactBuilderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseBooleanEnv(env.VIVD_ARTIFACT_BUILDER_ENABLED, false);
}

export async function requestConnectedArtifactBuild(options: {
  slug: string;
  version: number;
  kind: ConnectedArtifactBuildKind;
  commitHash?: string;
}): Promise<ConnectedArtifactBuildRequestResult> {
  if (!isConnectedMode()) {
    return { requested: false, reason: "not_connected" };
  }
  if (!isConnectedArtifactBuilderEnabled()) {
    return { requested: false, reason: "disabled" };
  }

  const config = getConnectedBackendAuthConfig();
  if (!config) {
    return { requested: false, reason: "missing_backend_auth" };
  }

  const response = await fetch(
    `${config.backendUrl}/api/trpc/studioApi.requestArtifactBuild`,
    {
      method: "POST",
      headers: buildConnectedBackendHeaders(config),
      body: JSON.stringify({
        studioId: config.studioId,
        slug: options.slug,
        version: options.version,
        kind: options.kind,
        ...(options.commitHash ? { commitHash: options.commitHash } : {}),
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(
      `studioApi.requestArtifactBuild failed (${response.status}): ${text}`,
    );
  }

  const body = (await response.json().catch(() => null)) as any;
  const result = (body?.result?.data?.json ??
    body?.result?.data ??
    body) as BackendArtifactBuildResponse | null;

  if (!result?.enabled || !result.accepted) {
    return { requested: false, reason: "backend_disabled" };
  }

  return {
    requested: true,
    deduped: Boolean(result.deduped),
    status:
      result.status === "building" ||
      result.status === "ready" ||
      result.status === "error"
        ? result.status
        : "queued",
  };
}
