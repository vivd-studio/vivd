import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import sizeOf from 'image-size';
import { log } from '../logger';

export function getImageDimensions(filePath: string): { width: number; height: number } {
    try {
        if (!fs.existsSync(filePath)) return { width: 0, height: 0 };
        const buffer = fs.readFileSync(filePath);
        const dimensions = sizeOf(buffer);
        return { width: dimensions.width || 0, height: dimensions.height || 0 };
    } catch (e) {
        log(`Error getting dimensions for ${filePath}: ${e}`);
        return { width: 0, height: 0 };
    }
}

export function getTopImages(outputDir: string): string[] {
    const descriptionPath = path.join(outputDir, 'image-files-description.txt');
    if (fs.existsSync(descriptionPath)) {
        const content = fs.readFileSync(descriptionPath, 'utf-8');
        // Parse lines like "- filename (WxH) - description"
        const lines = content.split('\n').filter(l => l.startsWith('- '));
        // They are already sorted by priority in analyzeImages
        return lines.slice(0, 5).map(line => {
            const match = line.match(/- (.*?) \(/);
            return match ? match[1] : '';
        }).filter(f => f);
    }

    // Fallback to reading directory
    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) return [];
    return fs.readdirSync(imagesDir)
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .slice(0, 5);
}

export async function convertSvgToPngBuffer(filepath: string): Promise<Buffer | null> {
    try {
        return await sharp(filepath)
            .png()
            .toBuffer();
    } catch (e) {
        log(`Failed to convert SVG to PNG buffer: ${filepath}. Error: ${e}`);
        return null;
    }
}
