import * as fs from "fs";
import { soloSelfHostDefaults } from "@vivd/shared/config";
import { z } from "zod";
import { inferSchemeForHost } from "../../lib/publicOrigin";
import {
  getSystemSettingJsonValue,
  setSystemSettingJsonValue,
  SYSTEM_SETTING_KEYS,
} from "./SystemSettingsService";
import { installProfileService } from "./InstallProfileService";

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

function parseBooleanEnv(value: string | null | undefined): boolean | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
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

function normalizeStoredSettings(
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

function buildSelfHostCaddyfile(settings: ResolvedInstanceNetworkSettings): string {
  const globalOptions: string[] = ["{"];
  if (settings.tlsMode !== "managed") {
    globalOptions.push("    auto_https off");
  }
  if (settings.tlsMode === "managed" && settings.acmeEmail) {
    globalOptions.push(`    email ${settings.acmeEmail}`);
  }
  globalOptions.push(
    "",
    "    admin 0.0.0.0:2019 {",
    `        origins ${soloSelfHostDefaults.caddyAdminUrl} http://backend:3000 http://localhost:2019 http://127.0.0.1:2019`,
    "    }",
    "}",
    "",
    `import ${soloSelfHostDefaults.caddySitesDir}/*.caddy`,
    "",
  );

  const host = settings.publicHost || "localhost";
  const address =
    settings.tlsMode === "managed" && !isLocalLikeHost(host) ? host : `http://${host}`;

  return `${globalOptions.join("\n")}${address} {
    handle_path ${soloSelfHostDefaults.localS3DownloadPath}/* {
        reverse_proxy minio:9000
    }

    handle /plugins/* {
        reverse_proxy backend:3000
    }

    handle /email/v1/feedback/* {
        reverse_proxy backend:3000
    }

    handle /vivd-studio/api/* {
        reverse_proxy backend:3000
    }

    handle /vivd-studio* {
        reverse_proxy frontend:80
    }

    import ${soloSelfHostDefaults.caddyRuntimeRoutesDir}/*.caddy

    handle /health {
        respond "OK" 200
    }

    import ${soloSelfHostDefaults.caddySitesDir}/_primary/*.caddy

    handle {
        root * ${soloSelfHostDefaults.publishedDir}
        try_files {path} {path}/index.html =404
        file_server
    }

    handle_errors {
        @404 expression {err.status_code} == 404
        handle @404 {
            respond "Not found" 404
        }
    }
}
`;
}

class InstanceNetworkSettingsService {
  private storedSettings: InstanceNetworkSettings = {};

  getResolvedSettings(): ResolvedInstanceNetworkSettings {
    const explicitHost = readExplicitHostEnv();
    const bootstrapHost = readBootstrapHostEnv();
    const storedHost = normalizeHostLike(this.storedSettings.publicHost) ?? null;

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
    const storedTlsMode = this.storedSettings.tlsMode ?? null;
    const tlsMode =
      storedTlsMode ?? bootstrapTlsMode ?? defaultTlsModeForHost(publicHost);
    const tlsModeSource =
      storedTlsMode != null
        ? "settings"
        : bootstrapTlsMode != null
          ? "bootstrap_env"
          : "default";

    const bootstrapAcmeEmail = readBootstrapAcmeEmailEnv();
    const storedAcmeEmail = normalizeAcmeEmail(this.storedSettings.acmeEmail);
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
    this.storedSettings = normalizeStoredSettings(
      await getSystemSettingJsonValue<unknown>(SYSTEM_SETTING_KEYS.instanceNetworkSettings),
    );
    return this.getResolvedSettings();
  }

  async updateStoredSettings(
    patch: InstanceNetworkSettings,
  ): Promise<ResolvedInstanceNetworkSettings> {
    this.storedSettings = normalizeStoredSettings({
      ...this.storedSettings,
      ...patch,
    });

    await setSystemSettingJsonValue(
      SYSTEM_SETTING_KEYS.instanceNetworkSettings,
      this.storedSettings,
    );

    return this.getResolvedSettings();
  }

  async syncSelfHostedCaddyConfig(): Promise<boolean> {
    const envOverride = parseBooleanEnv(process.env.VIVD_SELFHOST_CADDY_UI_MANAGED);
    const enabled =
      envOverride ?? ((await installProfileService.getInstallProfile()) === "solo");
    if (!enabled) {
      return false;
    }

    const caddyfilePath = process.env.CADDY_MAIN_CONFIG_PATH?.trim() || "/etc/caddy/Caddyfile";
    const resolved = this.getResolvedSettings();
    const content = buildSelfHostCaddyfile(resolved);

    try {
      const existing = fs.existsSync(caddyfilePath)
        ? fs.readFileSync(caddyfilePath, "utf-8")
        : null;
      if (existing === content) {
        return false;
      }

      fs.writeFileSync(caddyfilePath, content, "utf-8");
      return true;
    } catch (error) {
      console.warn(
        `[InstanceNetworkSettings] Failed to write self-host Caddyfile at ${caddyfilePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}

export const instanceNetworkSettingsService = new InstanceNetworkSettingsService();
