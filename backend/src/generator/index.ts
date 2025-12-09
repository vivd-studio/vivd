import { scrapeWebsite } from './scraper';
import { generateLandingPage } from './generator';
import { analyzeImages } from './image_analyzer';
import { createHeroImage } from './hero_creator';
import { log } from './logger';
import { validateConfig } from './config';

export { scrapeWebsite, generateLandingPage, analyzeImages, createHeroImage, log, validateConfig };
import * as path from 'path';
import * as fs from 'fs';

export async function processUrl(targetUrl: string) {
    validateConfig();

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    const domainSlug = new URL(targetUrl).hostname.replace('www.', '').split('.')[0];
    const outputDir = path.join(process.cwd(), 'generated', domainSlug);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
        await scrapeWebsite(targetUrl, outputDir);
        await analyzeImages(outputDir);
        await createHeroImage(outputDir);
        await generateLandingPage(outputDir);
        return { success: true, outputDir, domainSlug };
    } catch (error) {
        log(`An error occurred: ${error}`);
        throw error;
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npx tsx index.ts <url>');
        process.exit(1);
    }
    processUrl(args[0]).catch(error => {
        console.error('An error occurred:', error);
    });
}
