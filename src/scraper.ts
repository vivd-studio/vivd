import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { autoScroll, downloadImage, cleanText } from './utils';
import { MAX_SCREENSHOT_HEIGHT } from './config';

import { USE_LOCAL_AGENT } from './config';
import { OpenRouterAgent, LocalCursorAgent, GenerationAgent } from './agent';

puppeteer.use(StealthPlugin());

// TODO: Check vor url:... in background image, there are sometimes some images that we are not currently grabbing.
// example: <div class="IFuOkc" style="background-size: cover; background-position: center center; background-image: url(https://lh3.googleusercontent.com/sitesv/AAzXCkeXs8I6lUCsUizVVokNZuuyeATNDLm52C6NVy6egmntJxNJZJ8GktYqWVc0PIQSKlk_SAFlfpZFYOL9qd68IQuS2LjrH6F4M-qR1NXhd5bGi6SkvVqb8PkA005dpIvwLS2pAJNs7CmdOThxmHOhUvepsiG7ZM4GDhk=w16383);" jsname="LQX2Vd"></div>

export async function handleCookieBanner(page: any) {
    // Simple heuristic to find and click cookie buttons
    const terms = ['accept', 'agree', 'allow', 'consent', 'okay', 'i understand', 'akzeptieren', 'zustimmen', 'verstanden'];
    try {
        const buttons = await page.$$('button, a, div[role="button"]');
        for (const button of buttons) {
            const text = await page.evaluate((el: any) => el.innerText?.toLowerCase(), button);
            if (text && terms.some(term => text.includes(term))) {
                log(`Clicking potential cookie button: ${text}`);
                try {
                    await button.click();
                    await new Promise(r => setTimeout(r, 1000)); // Wait for banner to disappear
                } catch (e) {
                    log(`Error clicking button: ${e}`);
                }
            }
        }
    } catch (e) {
        log(`Error handling cookie banner: ${e}`);
    }

    // Aggressive cleanup: Remove elements that look like cookie banners
    await page.evaluate(() => {
        const cookieKeywords = ['cookie', 'privacy', 'datenschutz', 'consent', 'zustimmung'];
        const elements = document.querySelectorAll('div, section, aside, footer, header');

        elements.forEach((el: any) => {
            const style = window.getComputedStyle(el);
            const isFixedOrSticky = style.position === 'fixed' || style.position === 'sticky';
            const isBottomOrTop = style.bottom === '0px' || style.top === '0px';
            const hasKeywords = cookieKeywords.some(keyword => el.innerText?.toLowerCase().includes(keyword));

            if (isFixedOrSticky && (isBottomOrTop || hasKeywords)) {
                // Check if it's small enough to be a banner (not the whole page)
                const rect = el.getBoundingClientRect();
                if (rect.height < window.innerHeight * 0.5) {
                    console.log('Removing potential cookie banner:', el);
                    el.remove();
                }
            }
        });
    });
}

async function scrapePage(page: any, url: string, outputDir: string, isMainPage: boolean = false): Promise<{ text: string, images: string[] }> {
    log(`Navigating to ${url}...`);
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
        log(`Error navigating to ${url}: ${e}`);
        return { text: '', images: [] };
    }

    log('Handling cookies...');
    await handleCookieBanner(page);

    log('Scrolling...');
    await autoScroll(page);

    // Get Text
    const text = await page.evaluate(() => document.body.innerText);
    const cleanedText = cleanText(text);
    log(`Extracted ${text.length} characters of text.`);

    // Get Images
    const images = await page.evaluate(() => {
        return Array.from(document.images)
            .map(img => {
                const src = img.getAttribute('src');
                let url = '';
                if (src) {
                    if (src.startsWith('http') || src.startsWith('//')) {
                        url = img.src;
                    } else {
                        try {
                            url = new URL(src, window.location.href).href;
                        } catch (e) {
                            url = '';
                        }
                    }
                }
                return {
                    url,
                    area: (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0)
                };
            })
            .filter(item => item.url.startsWith('http'));
    });

    // Sort by area descending (largest first) to prioritize content images over small icons if limit is reached
    images.sort((a, b) => b.area - a.area);

    // Filter out tiny images
    const MIN_AREA = 40 * 40;
    const imageUrls = images
        .filter(i => i.area >= MIN_AREA)
        .map(i => i.url);

    log(`Found ${imageUrls.length} images (after filtering tiny ones).`);

    // Download Images
    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    let imgCount = 0;
    const downloadedNames = new Set<string>();
    const savedImages: string[] = [];

    // Limit images per page (increased to capture more)
    const imageLimit = isMainPage ? 50 : 30;

    for (const url of imageUrls.slice(0, imageLimit)) {
        const ext = path.extname(url).split('?')[0] || '.jpg';
        if (!['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext.toLowerCase())) continue;

        // Extract filename from URL
        let filename = path.basename(new URL(url).pathname);
        try {
            filename = decodeURIComponent(filename);
        } catch (e) {
            // ignore
        }

        // Sanitize filename
        filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

        // Ensure extension matches
        if (!filename.toLowerCase().endsWith(ext.toLowerCase())) {
            filename += ext;
        }

        // Handle duplicates
        let finalFilename = filename;
        let counter = 1;
        while (downloadedNames.has(finalFilename) || fs.existsSync(path.join(imagesDir, finalFilename))) {
            const namePart = path.basename(filename, ext);
            finalFilename = `${namePart}_${counter}${ext}`;
            counter++;
        }
        downloadedNames.add(finalFilename);

        const filepath = path.join(imagesDir, finalFilename);
        try {
            await downloadImage(url, filepath);
            savedImages.push(finalFilename);
            imgCount++;
        } catch (e) {
            log(`Failed to download image ${url}: ${e}`);
        }
    }
    log(`Downloaded ${imgCount} images from ${url}.`);

    return { text: cleanedText, images: savedImages };
}

async function findNavigationLinks(page: any): Promise<{ text: string, url: string }[]> {
    return await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
            .map(a => {
                let text = a.innerText.trim();
                if (!text) {
                    // Try to find an image with alt text
                    const img = a.querySelector('img');
                    if (img && img.alt) {
                        text = img.alt.trim();
                    }
                }

                // Explicitly resolve relative URLs to absolute
                let url = a.href;
                const hrefAttr = a.getAttribute('href');
                if (hrefAttr && !hrefAttr.startsWith('http') && !hrefAttr.startsWith('//') && !hrefAttr.startsWith('javascript:') && !hrefAttr.startsWith('mailto:') && !hrefAttr.startsWith('tel:') && !hrefAttr.startsWith('#')) {
                    try {
                        url = new URL(hrefAttr, window.location.href).href;
                    } catch (e) {
                        // Keep original a.href if resolution fails
                    }
                }

                return { text: text, url: url };
            })
            .filter(link => link.text.length > 0 && link.url.startsWith('http'));
    });
}

function deduplicateImages(outputDir: string) {
    log('Starting image deduplication...');
    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) return;

    const files = fs.readdirSync(imagesDir);
    const groups = new Map<string, string[]>();

    // Group files by canonical name (removing _\d+ suffix)
    for (const file of files) {
        const ext = path.extname(file);
        const nameWithoutExt = path.basename(file, ext);

        // Check if ends with _\d+
        const match = nameWithoutExt.match(/^(.*)_\d+$/);
        let canonicalName = file;
        if (match) {
            canonicalName = match[1] + ext;
        }

        if (!groups.has(canonicalName)) {
            groups.set(canonicalName, []);
        }
        groups.get(canonicalName)!.push(file);
    }

    let removedCount = 0;

    // Check for duplicates within groups based on file size
    for (const [canonicalName, groupFiles] of groups) {
        if (groupFiles.length < 2) continue;

        const sizeGroups = new Map<number, string[]>();
        for (const file of groupFiles) {
            const filepath = path.join(imagesDir, file);
            try {
                const stats = fs.statSync(filepath);
                const size = stats.size;
                if (!sizeGroups.has(size)) {
                    sizeGroups.set(size, []);
                }
                sizeGroups.get(size)!.push(file);
            } catch (e) {
                log(`Error checking file size for ${file}: ${e}`);
            }
        }

        // Remove duplicates within size groups
        for (const [size, filesWithSize] of sizeGroups) {
            if (filesWithSize.length > 1) {
                // Sort to keep the one with the shortest name (likely the original without suffix, or smallest suffix)
                filesWithSize.sort((a, b) => a.length - b.length || a.localeCompare(b));

                const keep = filesWithSize[0];
                const remove = filesWithSize.slice(1);

                for (const fileToRemove of remove) {
                    log(`Removing duplicate image: ${fileToRemove} (same size as ${keep})`);
                    fs.unlinkSync(path.join(imagesDir, fileToRemove));
                    removedCount++;
                }
            }
        }
    }
    log(`Deduplication complete. Removed ${removedCount} duplicate images.`);
}

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

        // 2. Find Navigation Links
        const links = await findNavigationLinks(page);
        log(`Found ${links.length} potential navigation links.`);

        // 3. Analyze Navigation with Agent
        const agent: GenerationAgent = USE_LOCAL_AGENT
            ? new LocalCursorAgent()
            : new OpenRouterAgent();

        const subpagesToScrape = await agent.analyzeNavigation(links);
        log(`Agent selected ${subpagesToScrape.length} subpages to scrape: ${subpagesToScrape.join(', ')}`);

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
