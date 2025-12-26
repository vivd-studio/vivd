import * as fs from 'fs';
import * as path from 'path';
import { generateHtml } from './steps/generateHtml';
import { log } from './logger';

export async function generateLandingPage(outputDir: string) {
    if (!fs.existsSync(path.join(outputDir, 'website_text.txt'))) return;
    try {
        await generateHtml({ outputDir, source: 'url' });
    } catch (error: any) {
        log(`Error generating landing page: ${error?.message || String(error)}`);
        if (error?.response) {
            log(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    }
}
