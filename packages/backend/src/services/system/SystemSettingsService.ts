import { eq } from "drizzle-orm";
import { db } from "../../db";
import { systemSetting } from "../../db/schema";

export const SYSTEM_SETTING_KEYS = {
  studioMachineImageTagOverride: "studio_machine_image_tag_override",
  studioAgentInstructionsTemplate: "studio_agent_instructions_template",
  installProfile: "install_profile",
  instanceCapabilityPolicy: "instance_capability_policy",
  instancePluginDefaults: "instance_plugin_defaults",
  instanceLimitDefaults: "instance_limit_defaults",
} as const;

export async function getSystemSettingValue(key: string): Promise<string | null> {
  const row = await db.query.systemSetting.findFirst({
    where: eq(systemSetting.key, key),
    columns: { value: true },
  });
  if (!row) return null;
  return typeof row.value === "string" ? row.value : null;
}

export async function setSystemSettingValue(
  key: string,
  value: string | null,
): Promise<void> {
  if (!value) {
    await db.delete(systemSetting).where(eq(systemSetting.key, key));
    return;
  }

  await db
    .insert(systemSetting)
    .values({ key, value })
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    });
}

export async function getSystemSettingJsonValue<T>(
  key: string,
): Promise<T | null> {
  const raw = await getSystemSettingValue(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(
      `[SystemSettings] Failed to parse JSON for "${key}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function setSystemSettingJsonValue(
  key: string,
  value: unknown | null,
): Promise<void> {
  if (value == null) {
    await setSystemSettingValue(key, null);
    return;
  }

  await setSystemSettingValue(key, JSON.stringify(value));
}
