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
