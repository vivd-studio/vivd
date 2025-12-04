import * as fs from 'fs';
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
