import { z } from "zod";

const GOOGLE_MAPS_EMBED_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
]);

function isGoogleMapsEmbedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!GOOGLE_MAPS_EMBED_HOSTS.has(url.hostname)) {
      return false;
    }

    return url.pathname.startsWith("/maps/embed");
  } catch {
    return false;
  }
}

export const googleMapsPluginConfigSchema = z.object({
  embedUrl: z
    .string()
    .trim()
    .min(1, "Paste a Google Maps embed URL.")
    .refine(isGoogleMapsEmbedUrl, {
      message: "Use a Google Maps embed URL from the provider share/embed flow.",
    }),
  title: z.string().trim().min(1).max(120).default("Google Map"),
  height: z.number().int().min(240).max(960).default(420),
  loading: z.enum(["lazy", "eager"]).default("lazy"),
  referrerPolicy: z
    .enum(["no-referrer-when-downgrade", "strict-origin-when-cross-origin"])
    .default("no-referrer-when-downgrade"),
});

export type GoogleMapsPluginConfig = z.infer<typeof googleMapsPluginConfigSchema>;

export const googleMapsPluginDefaultConfig = {
  embedUrl: "",
  title: "Google Map",
  height: 420,
  loading: "lazy",
  referrerPolicy: "no-referrer-when-downgrade",
} satisfies Record<string, unknown>;
