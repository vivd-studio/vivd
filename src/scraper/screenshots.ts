import { Page } from 'puppeteer';
import * as path from 'path';
import { log } from '../logger';
import { MAX_SCREENSHOT_HEIGHT } from '../config';

export async function takeMainPageScreenshot(page: Page, outputDir: string): Promise<void> {
    log('Taking screenshot of main page...');
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
    const headerScreenshotPath = path.join(outputDir, 'header_screenshot.png');
    await page.screenshot({
        path: headerScreenshotPath,
        fullPage: false,
        clip: { x: 0, y: 0, width: 1280, height: 500 } // Top 500px
    });
    return headerScreenshotPath;
}
