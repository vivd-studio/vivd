import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';
import { MAX_SCREENSHOT_HEIGHT } from '../config';
import { scrapePage } from './page';
import { extractNavigationLinks, findLinksMatchingTexts, prioritizeNavigationLinks } from './navigation';
import { deduplicateImages } from './images';

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
        log('Taking screenshot of main page...');
        const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
        const height = Math.min(bodyHeight, MAX_SCREENSHOT_HEIGHT);
        await page.screenshot({
            path: path.join(outputDir, 'screenshot.png'),
            fullPage: false,
            clip: { x: 0, y: 0, width: 1280, height: height }
        });
        log(`Screenshot saved to ${path.join(outputDir, 'screenshot.png')}`);

        // 2. Take Header Screenshot for Navigation Analysis
        log('Taking screenshot of header for navigation analysis...');
        const headerScreenshotPath = path.join(outputDir, 'header_screenshot.png');
        await page.screenshot({
            path: headerScreenshotPath,
            fullPage: false,
            clip: { x: 0, y: 0, width: 1280, height: 500 } // Top 500px
        });

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
