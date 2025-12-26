import { z } from "zod";

export const scratchSchema = z.object({
  title: z.string().min(1, "Business name is required"),
  businessType: z.string().optional(),
  description: z
    .string()
    .min(20, "Please add a bit more detail (min 20 chars)"),
  referenceUrlsText: z.string().optional(),
});

export type ScratchValues = z.infer<typeof scratchSchema>;

export type StylePreset = {
  id: string;
  name: string;
  description: string;
  palette: string[];
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "modern-minimal",
    name: "Modern Minimal",
    description: "Clean, dark, premium feel",
    palette: ["#0f172a", "#6366f1", "#818cf8", "#e0e7ff", "#ffffff"],
  },
  {
    id: "soft-pastel",
    name: "Soft Pastel",
    description: "Gentle, friendly tones",
    palette: ["#fdf2f8", "#fbcfe8", "#f9a8d4", "#a78bfa", "#5b21b6"],
  },
  {
    id: "neon-electric",
    name: "Neon Electric",
    description: "Bold, vibrant, high-energy",
    palette: ["#0d0d0d", "#39ff14", "#00f0ff", "#ff00ff", "#ffff00"],
  },
  {
    id: "warm-earth",
    name: "Warm Earth",
    description: "Natural, approachable warmth",
    palette: ["#1c1917", "#f97316", "#fbbf24", "#fef3c7", "#fffbeb"],
  },
  {
    id: "simple-mono",
    name: "Simple Mono",
    description: "Black & white elegance",
    palette: ["#000000", "#404040", "#808080", "#d4d4d4", "#ffffff"],
  },
];

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
