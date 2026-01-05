import * as fs from 'fs';
import { generateHtml } from './steps/generateHtml';
import { log } from './logger';
import { getVivdInternalFilesPath } from './vivdPaths';

export async function generateLandingPage(outputDir: string) {
    if (!fs.existsSync(getVivdInternalFilesPath(outputDir, 'website_text.txt'))) return;
    try {
        await generateHtml({ outputDir, source: 'url' });
    } catch (error: any) {
        log(`Error generating landing page: ${error?.message || String(error)}`);
        if (error?.response) {
            log(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    }
}
