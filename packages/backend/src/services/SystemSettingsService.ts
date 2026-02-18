import { eq } from "drizzle-orm";
import { db } from "../db";
import { systemSetting } from "../db/schema";

export const SYSTEM_SETTING_KEYS = {
  studioMachineImageTagOverride: "studio_machine_image_tag_override",
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

