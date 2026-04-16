import { z } from "zod";
import { inferSchemeForHost } from "../../lib/publicOrigin";
import {
  getSystemSettingJsonValue,
  SYSTEM_SETTING_KEYS,
} from "./SystemSettingsService";

export const instanceTlsModeSchema = z.enum(["managed", "external", "off"]);
export type InstanceTlsMode = z.infer<typeof instanceTlsModeSchema>;

export const instanceNetworkSettingsSchema = z
  .object({
    publicHost: z.string().trim().min(1).max(255).nullable().optional(),
    tlsMode: instanceTlsModeSchema.nullable().optional(),
    acmeEmail: z.string().trim().email().nullable().optional(),
  })
  .strict();

export type InstanceNetworkSettings = z.infer<typeof instanceNetworkSettingsSchema>;

export type ResolvedInstanceNetworkSettings = {
  publicHost: string | null;
  publicOrigin: string | null;
  tlsMode: InstanceTlsMode;
  acmeEmail: string | null;
  sources: {
    publicHost: "explicit_env" | "settings" | "bootstrap_env" | "default";
    tlsMode: "settings" | "bootstrap_env" | "default";
    acmeEmail: "settings" | "bootstrap_env" | "default";
  };
  deploymentManaged: {
    publicHost: boolean;
  };
};

function normalizeHostLike(value: string | undefined | null): string | null {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;

  const firstValue = trimmed.split(",")[0]?.trim() || "";
  if (!firstValue) return null;

  try {
    const parsed = /^https?:\/\//i.test(firstValue)
      ? new URL(firstValue)
      : new URL(`https://${firstValue}`);
    return parsed.host.toLowerCase();
  } catch {
    return firstValue
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
}

function normalizeTlsMode(
  value: string | null | undefined,
): InstanceTlsMode | null {
  const parsed = instanceTlsModeSchema.safeParse((value || "").trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

function normalizeAcmeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  return trimmed || null;
}

function isLocalLikeHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost")
  ) {
    return true;
  }
  return /^[\d.]+$/.test(normalized);
}

function defaultTlsModeForHost(host: string | null): InstanceTlsMode {
  if (!host) return "off";
  return isLocalLikeHost(host) ? "off" : "managed";
}

function deriveOrigin(host: string | null, tlsMode: InstanceTlsMode): string | null {
  if (!host) return null;
  if (tlsMode === "off") {
    return `http://${host}`;
  }
  const scheme = inferSchemeForHost(host);
  if (tlsMode === "managed" || tlsMode === "external") {
    return `${scheme === "http" ? "http" : "https"}://${host}`;
  }
  return `${scheme}://${host}`;
}

function readExplicitHostEnv(): string | null {
  return (
    normalizeHostLike(process.env.VIVD_APP_URL) ??
    normalizeHostLike(process.env.BETTER_AUTH_URL) ??
    normalizeHostLike(process.env.CONTROL_PLANE_HOST)
  );
}

function readBootstrapHostEnv(): string | null {
  return (
    normalizeHostLike(process.env.DOMAIN) ??
    normalizeHostLike(process.env.VIVD_CADDY_PRIMARY_HOST)
  );
}

function readBootstrapTlsModeEnv(): InstanceTlsMode | null {
  return normalizeTlsMode(process.env.VIVD_CADDY_TLS_MODE);
}

function readBootstrapAcmeEmailEnv(): string | null {
  return normalizeAcmeEmail(process.env.VIVD_CADDY_ACME_EMAIL);
}

export function normalizeStoredInstanceNetworkSettings(
  value: unknown,
): InstanceNetworkSettings {
  const parsed = instanceNetworkSettingsSchema.safeParse(value);
  if (!parsed.success) return {};
  return {
    publicHost: normalizeHostLike(parsed.data.publicHost) ?? null,
    tlsMode: parsed.data.tlsMode ?? null,
    acmeEmail: normalizeAcmeEmail(parsed.data.acmeEmail),
  };
}

let storedSettings: InstanceNetworkSettings = {};

class InstanceNetworkSettingsService {
  getResolvedSettings(): ResolvedInstanceNetworkSettings {
    const explicitHost = readExplicitHostEnv();
    const bootstrapHost = readBootstrapHostEnv();
    const storedHost = normalizeHostLike(storedSettings.publicHost) ?? null;

    const publicHost = explicitHost ?? storedHost ?? bootstrapHost ?? null;
    const publicHostSource =
      explicitHost != null
        ? "explicit_env"
        : storedHost != null
          ? "settings"
          : bootstrapHost != null
            ? "bootstrap_env"
            : "default";

    const bootstrapTlsMode = readBootstrapTlsModeEnv();
    const storedTlsMode = storedSettings.tlsMode ?? null;
    const tlsMode =
      storedTlsMode ?? bootstrapTlsMode ?? defaultTlsModeForHost(publicHost);
    const tlsModeSource =
      storedTlsMode != null
        ? "settings"
        : bootstrapTlsMode != null
          ? "bootstrap_env"
          : "default";

    const bootstrapAcmeEmail = readBootstrapAcmeEmailEnv();
    const storedAcmeEmail = normalizeAcmeEmail(storedSettings.acmeEmail);
    const acmeEmail = storedAcmeEmail ?? bootstrapAcmeEmail ?? null;
    const acmeEmailSource =
      storedAcmeEmail != null
        ? "settings"
        : bootstrapAcmeEmail != null
          ? "bootstrap_env"
          : "default";

    return {
      publicHost,
      publicOrigin: deriveOrigin(publicHost, tlsMode),
      tlsMode,
      acmeEmail,
      sources: {
        publicHost: publicHostSource,
        tlsMode: tlsModeSource,
        acmeEmail: acmeEmailSource,
      },
      deploymentManaged: {
        publicHost: explicitHost != null,
      },
    };
  }

  async refreshFromStore(): Promise<ResolvedInstanceNetworkSettings> {
    storedSettings = normalizeStoredInstanceNetworkSettings(
      await getSystemSettingJsonValue<unknown>(SYSTEM_SETTING_KEYS.instanceNetworkSettings),
    );
    return this.getResolvedSettings();
  }
}

export const instanceNetworkSettingsService = new InstanceNetworkSettingsService();
