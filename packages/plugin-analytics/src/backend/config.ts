import { z } from "zod";

const analyticsExcludedPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => value.startsWith("/"), {
    message: "Excluded paths must start with '/'",
  });

export const analyticsPluginConfigSchema = z.object({
  respectDoNotTrack: z.boolean().default(true),
  captureQueryString: z.boolean().default(false),
  excludedPaths: z.array(analyticsExcludedPathSchema).max(200).default([]),
  enableClientTracking: z.boolean().default(true),
});

export type AnalyticsPluginConfig = z.infer<typeof analyticsPluginConfigSchema>;
