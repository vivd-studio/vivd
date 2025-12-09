import { Page } from 'puppeteer';
import * as path from 'path';
import { log } from '../logger';
import { MAX_SCREENSHOT_HEIGHT } from '../config';

import sharp from 'sharp';

export async function takeMainPageScreenshot(page: Page, outputDir: string): Promise<void> {
    log('Taking screenshot of main page...');

    // Scroll to top and wait for any animations/sticky headers
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 2000));

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const height = Math.min(bodyHeight, MAX_SCREENSHOT_HEIGHT);
    await page.screenshot({
        path: path.join(outputDir, 'screenshot.png'),
        fullPage: false,
        clip: { x: 0, y: 0, width: 1280, height: height }
    });
    log(`Screenshot saved to ${path.join(outputDir, 'screenshot.png')}`);
}

export async function takeHeaderScreenshot(page: Page, outputDir: string): Promise<string> {
    log('Creating header screenshot from main page screenshot...');

    const mainScreenshotPath = path.join(outputDir, 'screenshot.png');
    const headerScreenshotPath = path.join(outputDir, 'header_screenshot.png');

    try {
        const image = sharp(mainScreenshotPath);
        const metadata = await image.metadata();

        const width = metadata.width || 1280;
        const height = metadata.height || 0;
        const cropHeight = Math.min(height, 800);

        if (cropHeight <= 0) {
            throw new Error("Main screenshot has invalid height");
        }

        await image
            .extract({ left: 0, top: 0, width: width, height: cropHeight })
            .toFile(headerScreenshotPath);

        log(`Header screenshot saved to ${headerScreenshotPath}`);
    } catch (error) {
        log(`Error creating header screenshot: ${error}`);
        // Fallback: take a new screenshot if the file operation fails
        log('Falling back to taking a new screenshot via puppeteer...');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
            path: headerScreenshotPath,
            fullPage: false,
            clip: { x: 0, y: 0, width: 1280, height: 800 }
        });
    }

    return headerScreenshotPath;
}
