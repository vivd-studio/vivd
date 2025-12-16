export const OPENROUTER_API_KEY = process.env._OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files
export const GENERATION_MODEL = "google/gemini-3-pro-preview"; // model to create index.html
export const ANALYSIS_MODEL = "google/gemini-3-pro-preview"; // model for text analysis and planning operations
export const LOCAL_GENERATION_MODEL = "gemini-3-pro"; // model that cursor-agent uses
// export const HERO_GENERATION_MODEL = 'google/gemini-2.5-flash-image-preview';
export const HERO_GENERATION_MODEL = "google/gemini-3-pro-image-preview";
export const PRIORITIZATION_MODEL = "google/gemini-2.5-flash";
export const NAVIGATION_MODEL = "google/gemini-2.5-flash";
export const VISION_MODEL = "google/gemma-3-12b-it:free"; // model to describe images
export const ENABLE_IMAGE_ANALYSIS = true;
export const USE_LOCAL_AGENT = false;
export const LOCAL_AGENT_COMMAND = "cursor-agent";
export const MAX_SCRAPE_SUBPAGES = 10;
export const MAX_IMAGES_TO_ANALYZE = 30;

export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

export const OPENCODE_MODEL = process.env.OPENCODE_MODEL;

export function validateConfig() {
  if (!process.env._OPENROUTER_API_KEY && !process.env.USE_LOCAL_AGENT) {
    throw new Error(
      "Please set OPENROUTER_API_KEY in your .env file or set USE_LOCAL_AGENT=true."
    );
  }
}
