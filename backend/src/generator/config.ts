export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files
export const GENERATION_MODEL = "google/gemini-3-pro-preview"; // model to create index.html
export const ANALYSIS_MODEL = "google/gemini-3-pro-preview"; // model for text analysis and planning operations
// export const HERO_GENERATION_MODEL = 'google/gemini-2.5-flash-image-preview';
export const HERO_GENERATION_MODEL = "google/gemini-3-pro-image-preview";
export const IMAGE_EDITING_MODEL = "google/gemini-3-pro-image-preview"; // model for AI image editing
export const BACKGROUND_REMOVAL_MODEL = "openai/gpt-5-image"; // GPT-5 for transparent background removal
export const PRIORITIZATION_MODEL = "google/gemini-2.5-flash";
export const NAVIGATION_MODEL = "google/gemini-2.5-flash";
export const VISION_MODEL = "google/gemma-3-12b-it:free"; // model to describe images
export const ENABLE_IMAGE_ANALYSIS = true;
export const MAX_SCRAPE_SUBPAGES = 10;
export const MAX_IMAGES_TO_ANALYZE = 30;

export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

export const OPENCODE_MODEL = process.env.OPENCODE_MODEL;

export function validateConfig() {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Please set OPENROUTER_API_KEY in your .env file.");
  }
}
