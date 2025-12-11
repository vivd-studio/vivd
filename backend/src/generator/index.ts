import { scrapeWebsite } from './scraper/index';
import { generateLandingPage } from './generator';
import { analyzeImages } from './image_analyzer/index';
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

    // Save project metadata
    const projectJsonPath = path.join(outputDir, 'project.json');
    const projectData = {
        url: targetUrl,
        createdAt: new Date().toISOString(),
        status: 'pending'
    };
    fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2));

    const updateStatus = (status: string) => {
        const currentData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        currentData.status = status;
        fs.writeFileSync(projectJsonPath, JSON.stringify(currentData, null, 2));
    };

    try {
        updateStatus('scraping');
        await scrapeWebsite(targetUrl, outputDir);

        updateStatus('analyzing_images');
        await analyzeImages(outputDir);

        updateStatus('creating_hero');
        await createHeroImage(outputDir);

        updateStatus('generating_html');
        await generateLandingPage(outputDir);

        updateStatus('completed');
        return { success: true, outputDir, domainSlug };
    } catch (error) {
        log(`An error occurred: ${error}`);
        try {
            updateStatus('failed');
        } catch (writeError) {
            console.error('Failed to write failure status to project.json:', writeError);
        }
        throw error;
    }
}


