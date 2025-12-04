import dotenv from 'dotenv';

dotenv.config();

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files
export const GENERATION_MODEL = 'google/gemini-3-pro-preview'; // model to create index.html
export const LOCAL_GENERATION_MODEL = 'gemini-3-pro'; // model that cursor-agent uses
export const HERO_GENERATION_MODEL = 'google/gemini-2.5-flash-image-preview';
export const PRIORITIZATION_MODEL = 'google/gemini-2.5-flash';
export const NAVIGATION_MODEL = 'google/gemini-2.5-flash';
export const VISION_MODEL = 'google/gemma-3-12b-it:free'; // model to describe images
export const ENABLE_IMAGE_ANALYSIS = true;
export const USE_LOCAL_AGENT = false;
export const LOCAL_AGENT_COMMAND = 'cursor-agent';

export function validateConfig() {
    if (!OPENROUTER_API_KEY && !USE_LOCAL_AGENT) {
        console.error('Please set OPENROUTER_API_KEY in your .env file or set USE_LOCAL_AGENT=true.');
        process.exit(1);
    }
}
