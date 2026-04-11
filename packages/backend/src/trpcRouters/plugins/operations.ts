import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PluginActionArgumentError,
  projectPluginService,
  UnsupportedPluginReadError,
  UnsupportedPluginActionError,
} from "../../services/plugins/ProjectPluginService";
import { getPluginModule, type PluginId } from "../../services/plugins/registry";

type PluginOperationKind = "read" | "updateConfig" | "runAction";

export function extractRequestHost(
  rawHost: string | string[] | undefined,
): string | null {
  if (typeof rawHost === "string") {
    const normalized = rawHost.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }
  if (Array.isArray(rawHost) && rawHost.length > 0) {
    const normalized = rawHost[0]?.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }
  return null;
}

export function throwPluginOperationError(options: {
  pluginId: PluginId;
  operation: PluginOperationKind;
  error: unknown;
  actionId?: string;
  readId?: string;
}): never {
  const mappedError = getPluginModule(options.pluginId).mapPublicError?.({
    operation: options.operation,
    error: options.error,
    actionId: options.actionId,
    readId: options.readId,
  });
  if (mappedError) {
    throw new TRPCError(mappedError);
  }
  if (options.error instanceof z.ZodError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: options.error.issues[0]?.message ?? "Invalid plugin config",
    });
  }
  if (
    options.error instanceof UnsupportedPluginReadError ||
    options.error instanceof UnsupportedPluginActionError ||
    options.error instanceof PluginActionArgumentError
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: options.error.message,
    });
  }
  throw options.error;
}

export async function getProjectPluginInfo(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: PluginId;
}) {
  return projectPluginService.getPluginInfoContract(options);
}

export async function ensureProjectPluginInstance(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: PluginId;
}) {
  return projectPluginService.ensurePluginInstance(options);
}

export async function updateProjectPluginConfig(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: PluginId;
  config: Record<string, unknown>;
}) {
  try {
    return await projectPluginService.updatePluginConfigById(options);
  } catch (error) {
    throwPluginOperationError({
      pluginId: options.pluginId,
      operation: "updateConfig",
      error,
    });
  }
}

export async function readProjectPluginData(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: PluginId;
  readId: string;
  input?: Record<string, unknown>;
}) {
  try {
    return await projectPluginService.readPluginData(options);
  } catch (error) {
    throwPluginOperationError({
      pluginId: options.pluginId,
      operation: "read",
      readId: options.readId,
      error,
    });
  }
}

export async function runProjectPluginAction(options: {
  organizationId: string;
  projectSlug: string;
  pluginId: PluginId;
  actionId: string;
  args: string[];
  requestedByUserId?: string | null;
  requestHost?: string | null;
}) {
  try {
    return await projectPluginService.runPluginAction(options);
  } catch (error) {
    throwPluginOperationError({
      pluginId: options.pluginId,
      operation: "runAction",
      actionId: options.actionId,
      error,
    });
  }
}
