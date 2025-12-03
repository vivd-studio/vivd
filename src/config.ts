import dotenv from 'dotenv';

dotenv.config();

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files
export const PRIORITIZATION_MODEL = 'google/gemini-2.0-flash-exp:free';
export const VISION_MODEL = 'google/gemma-3-12b-it:free';

if (!OPENROUTER_API_KEY) {
    console.error('Please set OPENROUTER_API_KEY in your .env file.');
    process.exit(1);
}
