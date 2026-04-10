import * as fs from 'fs';
import { log } from '../logger';
import type { ImageInfo } from './types';
import { ensureVivdInternalFilesDir, getVivdInternalFilesPath } from '../vivdPaths';

export function generateImageDescriptionFile(
    images: ImageInfo[],
    outputDir: string,
    imageRootRelativePath = 'images',
) {
    let content = `Image Files Description\n\nImages are in ${imageRootRelativePath}/ folder.\n\n`;

    // Sort: Analyzed first (by priority index), then unanalyzed
    const sortedImages = [...images].sort((a, b) => {
        if (a.analyzed && !b.analyzed) return -1;
        if (!a.analyzed && b.analyzed) return 1;
        if (a.analyzed && b.analyzed) return (a.priorityIndex || 999) - (b.priorityIndex || 999);
        return 0;
    });

    for (const img of sortedImages) {
        if (img.analyzed) {
            content += `- ${img.filename} (${img.width}x${img.height}) - ${img.description}\n`;
        } else {
            content += `- ${img.filename} (${img.width}x${img.height}) - Not analyzed\n`;
        }
    }

    ensureVivdInternalFilesDir(outputDir);
    fs.writeFileSync(
        getVivdInternalFilesPath(outputDir, 'image-files-description.txt'),
        content
    );
    log(`Generated image-files-description.txt`);
}
