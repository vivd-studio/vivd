import dotenv from 'dotenv';

dotenv.config();

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const MAX_SCREENSHOT_HEIGHT = 2000; // Limit screenshot height to avoid huge files

if (!OPENROUTER_API_KEY) {
    console.error('Please set OPENROUTER_API_KEY in your .env file.');
    process.exit(1);
}
