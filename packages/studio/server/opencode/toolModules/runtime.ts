export interface ToolRuntimeConfig {
  backendUrl: string;
  sessionToken: string;
  projectSlug: string;
  organizationId: string;
}

export function getRuntimeConfig(): ToolRuntimeConfig {
  const backendUrl = (process.env.MAIN_BACKEND_URL || "").trim();
  const sessionToken = (process.env.SESSION_TOKEN || "").trim();
  const projectSlug = (process.env.VIVD_PROJECT_SLUG || "").trim();
  const organizationId = (process.env.VIVD_TENANT_ID || "").trim();
  return { backendUrl, sessionToken, projectSlug, organizationId };
}

export function validateConnectedRuntime(
  config: ToolRuntimeConfig,
  toolName: string,
): string | null {
  if (config.backendUrl && config.sessionToken && config.projectSlug) {
    return null;
  }
  return `${toolName}: missing MAIN_BACKEND_URL, SESSION_TOKEN, or VIVD_PROJECT_SLUG`;
}

function unwrapTrpcBody(body: any): any {
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

export async function callTrpcQuery(
  procedure: string,
  input: Record<string, unknown>,
  config: ToolRuntimeConfig,
): Promise<any> {
  const url = `${config.backendUrl}/api/trpc/${procedure}?input=${encodeURIComponent(
    JSON.stringify(input),
  )}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.sessionToken}`,
      ...(config.organizationId
        ? { "x-vivd-organization-id": config.organizationId }
        : {}),
    },
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${errorText}`);
  }
  const body = await response.json();
  return unwrapTrpcBody(body);
}

export async function callTrpcMutation(
  procedure: string,
  input: Record<string, unknown>,
  config: ToolRuntimeConfig,
): Promise<any> {
  const response = await fetch(`${config.backendUrl}/api/trpc/${procedure}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.sessionToken}`,
      ...(config.organizationId
        ? { "x-vivd-organization-id": config.organizationId }
        : {}),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${errorText}`);
  }
  const body = await response.json();
  return unwrapTrpcBody(body);
}
