import axios from 'axios';
import * as fs from 'fs';
import { log } from './logger';

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

export async function downloadImage(url: string, filepath: string) {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });
        return new Promise((resolve, reject) => {
            response.data.pipe(fs.createWriteStream(filepath))
                .on('error', reject)
                .once('close', () => resolve(filepath));
        });
    } catch (e) {
        log(`Failed to download image: ${url}`);
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

    // 2. Fallback: Try markdown code block (relaxed regex)
    const codeBlockMatch = text.match(/```html\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1];
    }

    // 3. Fallback: return original text
    return text;
}
