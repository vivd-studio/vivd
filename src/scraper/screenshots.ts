import { Page } from 'puppeteer';
import * as path from 'path';
import { log } from '../logger';
import { MAX_SCREENSHOT_HEIGHT } from '../config';

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
    log('Taking screenshot of header for navigation analysis...');

    // Scroll to top and wait for any animations/sticky headers
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 2000));

    const headerScreenshotPath = path.join(outputDir, 'header_screenshot.png');
    await page.screenshot({
        path: headerScreenshotPath,
        fullPage: false,
        clip: { x: 0, y: 0, width: 1280, height: 1080 } // Top 1080px
    });
    return headerScreenshotPath;
}
