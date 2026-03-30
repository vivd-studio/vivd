export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files
export const WEBP_QUALITY = 85; // Quality setting for WebP image conversions (1-100)

function readModelEnv(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

export const GENERATION_MODEL = readModelEnv(
  "VIVD_GENERATION_MODEL",
  "google/gemini-3.1-pro-preview",
); // model to create index.html
export const ANALYSIS_MODEL = readModelEnv(
  "VIVD_ANALYSIS_MODEL",
  GENERATION_MODEL,
); // model for text analysis and planning operations
export const HERO_GENERATION_MODEL = readModelEnv(
  "VIVD_HERO_GENERATION_MODEL",
  "google/gemini-3-pro-image-preview",
);
export const IMAGE_EDITING_MODEL = readModelEnv(
  "VIVD_IMAGE_EDITING_MODEL",
  HERO_GENERATION_MODEL,
); // model for AI image editing
export const BACKGROUND_REMOVAL_MODEL = "openai/gpt-5-image"; // GPT-5 for transparent background removal
export const PRIORITIZATION_MODEL = "google/gemini-2.5-flash";
export const NAVIGATION_MODEL = "google/gemini-2.5-flash";
export const VISION_MODEL = "google/gemma-3-12b-it:free"; // model to describe images
export const ENABLE_IMAGE_ANALYSIS = true;
export const MAX_SCRAPE_SUBPAGES = 10;
export const MAX_IMAGES_TO_ANALYZE = 30;

export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

export function validateConfig() {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Please set OPENROUTER_API_KEY in your .env file.");
  }
}
