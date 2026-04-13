import type { Context } from "../trpc/context.js";
import {
  buildConnectedUserActionHeaders,
  getConnectedUserActionAuthConfig,
} from "../lib/connectedUserActionAuth.js";

const ALLOWED_DOTFILES = [".vivd", ".gitignore", ".env.example"];

export function hasDotSegment(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.some(
    (segment) =>
      segment.startsWith(".") && !ALLOWED_DOTFILES.includes(segment),
  );
}

export async function callConnectedBackendQuery<T>(
  ctx: Context,
  procedure: string,
  input: Record<string, unknown>,
): Promise<T> {
  const config = getConnectedUserActionAuthConfig(ctx.req);
  if (!config) {
    throw new Error("Connected Studio user action auth is not configured");
  }

  const response = await fetch(
    `${config.backendUrl}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
    {
      method: "GET",
      headers: buildConnectedUserActionHeaders(config, {
        includeContentType: false,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as any;
  return (body?.result?.data?.json ?? body?.result?.data ?? body) as T;
}

export async function callConnectedBackendMutation<T>(
  ctx: Context,
  procedure: string,
  input: Record<string, unknown>,
): Promise<T> {
  const config = getConnectedUserActionAuthConfig(ctx.req);
  if (!config) {
    throw new Error("Connected Studio user action auth is not configured");
  }

  const response = await fetch(`${config.backendUrl}/api/trpc/${procedure}`, {
    method: "POST",
    headers: buildConnectedUserActionHeaders(config),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as any;
  return (body?.result?.data?.json ?? body?.result?.data ?? body) as T;
}
