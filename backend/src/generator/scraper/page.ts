import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';
import { autoScroll, downloadImage, cleanText } from '../utils';
import { handleCookieBanner } from './cookie';

export async function scrapePage(page: any, url: string, outputDir: string, isMainPage: boolean = false): Promise<{ text: string, images: string[] }> {
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

    // Get Text from all frames
    let text = "";
    const frames = page.frames();
    for (const frame of frames) {
        try {
            const frameText = await frame.evaluate(() => document.body.innerText);
            if (frameText) {
                text += frameText + "\n";
            }
        } catch (e) {
            // Ignore cross-origin frame errors or empty frames
        }
    }
    const cleanedText = cleanText(text);
    log(`Extracted ${text.length} characters of text from ${frames.length} frames.`);

    // Get Images
    type ImageInfo = { url: string; area: number };
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
    }) as ImageInfo[];

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
