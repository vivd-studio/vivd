import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { autoScroll, downloadImage } from './utils';
import { MAX_SCREENSHOT_HEIGHT } from './config';

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

export async function scrapeWebsite(url: string, outputDir: string) {
    log(`Target URL: ${url}`);

    const browser = await puppeteer.launch({ headless: false }); // Headless false to see what's happening
    const page = await browser.newPage();

    try {
        // Set viewport
        await page.setViewport({ width: 1280, height: 800 });

        log('Navigating...');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        log('Handling cookies...');
        await handleCookieBanner(page);

        log('Scrolling...');
        await autoScroll(page);

        // Get Text
        const text = await page.evaluate(() => document.body.innerText);
        log(`Extracted ${text.length} characters of text.`);
        fs.writeFileSync(path.join(outputDir, 'website_text.txt'), text);

        // Get Images
        const imageUrls = await page.evaluate(() => {
            return Array.from(document.images).map(img => img.src).filter(src => src.startsWith('http'));
        });
        log(`Found ${imageUrls.length} images.`);

        // Download Images
        const imagesDir = path.join(outputDir, 'images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
        let imgCount = 0;
        const downloadedNames = new Set<string>();

        for (const url of imageUrls.slice(0, 15)) { // Increased limit slightly
            const ext = path.extname(url).split('?')[0] || '.jpg';
            if (!['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext.toLowerCase())) continue;

            // Extract filename from URL
            let filename = path.basename(new URL(url).pathname);
            // Decode URI components (e.g. %20 -> space)
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
            while (downloadedNames.has(finalFilename)) {
                const namePart = path.basename(filename, ext);
                finalFilename = `${namePart}_${counter}${ext}`;
                counter++;
            }
            downloadedNames.add(finalFilename);

            const filepath = path.join(imagesDir, finalFilename);
            await downloadImage(url, filepath);
            imgCount++;
        }
        log(`Downloaded ${imgCount} images.`);

        // Screenshot
        log('Taking screenshot...');
        // Clip screenshot if too long
        const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
        const height = Math.min(bodyHeight, MAX_SCREENSHOT_HEIGHT);

        await page.screenshot({
            path: path.join(outputDir, 'screenshot.png'),
            fullPage: false,
            clip: { x: 0, y: 0, width: 1280, height: height }
        });
        log(`Screenshot saved to ${path.join(outputDir, 'screenshot.png')}`);

    } catch (error) {
        log(`Error during scraping: ${error}`);
        throw error;
    } finally {
        await browser.close();
    }
}
