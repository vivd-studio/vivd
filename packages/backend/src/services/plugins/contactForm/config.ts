import { z } from "zod";

export const contactFormPluginConfigSchema = z.object({
  recipientEmails: z.array(z.string().email()).default([]),
  sourceHosts: z.array(z.string().min(1)).default([]),
  redirectHostAllowlist: z.array(z.string().min(1)).default([]),
});

export type ContactFormPluginConfig = z.infer<typeof contactFormPluginConfigSchema>;
