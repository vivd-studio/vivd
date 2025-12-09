import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { cleanText } from './utils';
import { ENABLE_IMAGE_ANALYSIS, USE_LOCAL_AGENT } from './config';
import { OPEN_ROUTER_LANDING_PAGE_PROMPT, LOCAL_AGENT_LANDING_PAGE_PROMPT, getImagesSection } from './prompts';
import { OpenRouterAgent, LocalCursorAgent } from './agent';
import type { GenerationAgent } from './agent';

export async function generateLandingPage(outputDir: string) {
    const agent: GenerationAgent = USE_LOCAL_AGENT
        ? new LocalCursorAgent()
        : new OpenRouterAgent();

    const textPath = path.join(outputDir, 'website_text.txt');
    if (!fs.existsSync(textPath)) {
        log('website_text.txt not found, skipping generation.');
        return;
    }

    const rawText = fs.readFileSync(textPath, 'utf-8');
    const text = cleanText(rawText).substring(0, 30000); // Limit text context
    const screenshotPath = path.join(outputDir, 'screenshot.png');

    const imageList = fs.existsSync(path.join(outputDir, 'image-files-description.txt'))
        ? fs.readFileSync(path.join(outputDir, 'image-files-description.txt'), 'utf-8')
        : fs.readdirSync(path.join(outputDir, 'images')).map(file => `- images/${file}`).join('\n');

    // If ENABLE_IMAGE_ANALYSIS is true, we assume the image list contains descriptions (if analyzed).
    // If false, we explicitly tell the model there are no descriptions.
    const imagesSection = getImagesSection(imageList, ENABLE_IMAGE_ANALYSIS);

    try {
        // Choose the appropriate prompt based on the agent
        let prompt: string;
        if (USE_LOCAL_AGENT) {
            prompt = LOCAL_AGENT_LANDING_PAGE_PROMPT(text, imagesSection);
        } else {
            prompt = OPEN_ROUTER_LANDING_PAGE_PROMPT(text, imagesSection);
        }

        // The agent is now responsible for creating the files directly
        await agent.generate(prompt, screenshotPath, outputDir);
    } catch (error: any) {
        log(`Error generating landing page: ${error.message}`);
        if (error.response) {
            log(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    }
}
