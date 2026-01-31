import axios from 'axios';
import * as fs from 'fs';
import sharp from 'sharp';
import { log } from './logger';
import { WEBP_QUALITY } from './config';

export async function autoScroll(page: any) {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 10000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

/**
 * Saves a buffer to a file, converting to WebP if the extension matches.
 */
export async function saveImageBuffer(buffer: Buffer, filepath: string) {
    if (filepath.endsWith('.webp')) {
        await sharp(buffer)
            .webp({ quality: WEBP_QUALITY })
            .toFile(filepath);
    } else {
        await fs.promises.writeFile(filepath, buffer);
    }
}

/**
 * Downloads an image from a URL and saves it to a file.
 * Uses saveImageBuffer for optional WebP conversion.
 */
export async function downloadImage(url: string, filepath: string) {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        await saveImageBuffer(response.data, filepath);

        return filepath;
    } catch (e) {
        log(`Failed to download image: ${url} - ${e}`);
        throw e;
    }
}

export function cleanText(text: string): string {
    return text
        // Normalize newlines
        .replace(/\r\n/g, '\n')
        // Replace non-breaking spaces
        .replace(/\u00A0/g, ' ')
        // Trim each line
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        // Replace 3+ newlines with 2
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function parseJsonFromLLM(content: string | null): any {
    if (!content) return null;

    try {
        return JSON.parse(content);
    } catch (e) {
        // Handle markdown code blocks
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) ||
            content.match(/\{[\s\S]*\}/) ||
            content.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1] || jsonMatch[0]);
            } catch (e2) {
                return null;
            }
        }
    }
    return null;
}

export function extractHtmlFromText(text: string): string {
    // 1. Try to find HTML content, optionally starting with DOCTYPE
    // This regex looks for an optional DOCTYPE tag, followed by <html ... </html>
    // It captures everything from the first match of either DOCTYPE or <html> until the last </html>
    const htmlRegex = /(?:<!DOCTYPE[^>]*>\s*)?<html[\s\S]*<\/html>/i;
    const match = text.match(htmlRegex);
    if (match) {
        return match[0];
    }

    // 2. Fallback: Try generic markdown code block
    // Matches ``` followed by optional language identifier, content, then ```
    // This allows for case-insensitivity and other languages, or no language
    const codeBlockMatch = text.match(/```[\w-]*\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1];
    }

    // 3. Last resort: Manual cleanup of markdown tags if regex failed (e.g. truncated)
    // If text starts with ``` but didn't match the block regex (likely missing end),
    // we strip the start and potentially the end if it exists.
    let cleanText = text.trim();
    if (cleanText.startsWith('```')) {
        const lines = cleanText.split('\n');
        // Remove the first line (the ``` line)
        if (lines.length > 0) lines.shift();

        // Check if the last line is just ``` and remove it (in case regex failed for some other reason)
        if (lines.length > 0 && lines[lines.length - 1].trim().startsWith('```')) {
            lines.pop();
        }

        return lines.join('\n').trim();
    }

    // 4. Fallback: return original text
    return text;
}
