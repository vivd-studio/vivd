import { scrapeWebsite } from './src/scraper';
import { generateLandingPage } from './src/generator';
import { analyzeImages } from './src/image_analyzer';
import { createHeroImage } from './src/hero_creator';
import { log } from './src/logger';
import { validateConfig } from './src/config';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
    validateConfig();
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: npx tsx index.ts <url>');
        process.exit(1);
    }

    let targetUrl = args[0];
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
    } catch (error) {
        log(`An error occurred: ${error}`);
    }
}

main().catch(error => {
    console.error('An error occurred:', error);
});
