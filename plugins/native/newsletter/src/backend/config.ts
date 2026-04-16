import { z } from "zod";

export const newsletterPluginModeSchema = z.enum(["newsletter", "waitlist"]);
export type NewsletterPluginMode = z.infer<typeof newsletterPluginModeSchema>;

export const newsletterPluginConfigSchema = z.object({
  mode: newsletterPluginModeSchema.default("newsletter"),
  collectName: z.boolean().default(false),
  sourceHosts: z.array(z.string().trim().min(1)).default([]),
  redirectHostAllowlist: z.array(z.string().trim().min(1)).default([]),
});

export type NewsletterPluginConfig = z.infer<
  typeof newsletterPluginConfigSchema
>;
