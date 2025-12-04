import dotenv from 'dotenv';

dotenv.config();

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files
export const GENERATION_MODEL = 'google/gemini-3-pro-preview';
export const HERO_GENERATION_MODEL = 'google/gemini-2.5-flash-image-preview';
export const LOCAL_GENERATION_MODEL = 'gemini-3-pro';
export const PRIORITIZATION_MODEL = 'google/gemini-2.5-flash';
export const VISION_MODEL = 'google/gemma-3-12b-it:free';
export const ENABLE_IMAGE_ANALYSIS = true;
export const USE_LOCAL_AGENT = false;
export const LOCAL_AGENT_COMMAND = 'cursor-agent';

if (!OPENROUTER_API_KEY && !USE_LOCAL_AGENT) {
    console.error('Please set OPENROUTER_API_KEY in your .env file or set USE_LOCAL_AGENT=true.');
    process.exit(1);
}
