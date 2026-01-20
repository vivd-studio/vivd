import * as z from "zod";

/**
 * Shared form schemas for project creation flows.
 */

/**
 * Schema for URL-based project creation with ownership disclaimer.
 */
export const urlFormSchema = z.object({
  url: z.string().min(1, "URL is required"),
  disclaimer: z.boolean().refine((val) => val === true, {
    message: "You must confirm that you own this website",
  }),
});

export type UrlFormValues = z.infer<typeof urlFormSchema>;

/**
 * Normalize a URL by adding https:// if missing.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}
