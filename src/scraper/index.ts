import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';
import { scrapePage } from './page';
import { extractNavigationLinks, findLinksMatchingTexts, prioritizeNavigationLinks } from './navigation';
import { deduplicateImages } from './images';
import { takeMainPageScreenshot, takeHeaderScreenshot } from './screenshots';

puppeteer.use(StealthPlugin());

export async function scrapeWebsite(url: string, outputDir: string) {
    log(`Target URL: ${url}`);

    const browser = await puppeteer.launch({ headless: false }); // Headless false to see what's happening
    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    try {
        // 1. Scrape Main Page
        const mainPageData = await scrapePage(page, url, outputDir, true);

        // Screenshot Main Page
        await takeMainPageScreenshot(page, outputDir);

        // 2. Take Header Screenshot for Navigation Analysis
        const headerScreenshotPath = await takeHeaderScreenshot(page, outputDir);

        // 3. Analyze Navigation with Vision Model
        const navigationTexts = await extractNavigationLinks(headerScreenshotPath);
        log(`Vision model identified navigation terms: ${navigationTexts.join(', ')}`);

        // 4. Find Matching Links in DOM
        const matchingLinks = await findLinksMatchingTexts(page, navigationTexts);
        log(`Found ${matchingLinks.length} matching links.`);

        // 5. Prioritize Links
        const subpagesToScrape = await prioritizeNavigationLinks(matchingLinks.map(url => ({ text: '', url })));


        log(`Agent prioritized ${subpagesToScrape.length} subpages to scrape: ${subpagesToScrape.join(', ')}`);

        // 4. Scrape Subpages
        let aggregatedText = `## Page: Home\n\n${mainPageData.text}\n\n`;

        for (const subpageUrl of subpagesToScrape) {
            // Avoid scraping the main page again if it's in the list
            if (subpageUrl === url || subpageUrl === url + '/') continue;

            log(`Scraping subpage: ${subpageUrl}`);
            const subpageData = await scrapePage(page, subpageUrl, outputDir, false);

            // Add header and text
            aggregatedText += `## Page: ${subpageUrl}\n\n${subpageData.text}\n\n`;
        }

        // 5. Save Aggregated Text
        fs.writeFileSync(path.join(outputDir, 'website_text.txt'), aggregatedText);
        log(`Saved aggregated text to website_text.txt`);

        // 6. Deduplicate Images
        deduplicateImages(outputDir);

    } catch (error) {
        log(`Error during scraping: ${error}`);
        throw error;
    } finally {
        await browser.close();
    }
}

export * from './cookie';
export * from './images';
export * from './navigation';
export * from './page';
