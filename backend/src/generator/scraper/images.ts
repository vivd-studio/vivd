import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logger';

export function deduplicateImages(outputDir: string) {
    log('Starting image deduplication...');
    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) return;

    const files = fs.readdirSync(imagesDir);
    const groups = new Map<string, string[]>();

    // Group files by canonical name (removing _\d+ suffix)
    for (const file of files) {
        const ext = path.extname(file);
        const nameWithoutExt = path.basename(file, ext);

        // Check if ends with _\d+
        const match = nameWithoutExt.match(/^(.*)_\d+$/);
        let canonicalName = file;
        if (match) {
            canonicalName = match[1] + ext;
        }

        if (!groups.has(canonicalName)) {
            groups.set(canonicalName, []);
        }
        groups.get(canonicalName)!.push(file);
    }

    let removedCount = 0;

    // Check for duplicates within groups based on file size
    for (const [canonicalName, groupFiles] of groups) {
        if (groupFiles.length < 2) continue;

        const sizeGroups = new Map<number, string[]>();
        for (const file of groupFiles) {
            const filepath = path.join(imagesDir, file);
            try {
                const stats = fs.statSync(filepath);
                const size = stats.size;
                if (!sizeGroups.has(size)) {
                    sizeGroups.set(size, []);
                }
                sizeGroups.get(size)!.push(file);
            } catch (e) {
                log(`Error checking file size for ${file}: ${e}`);
            }
        }

        // Remove duplicates within size groups
        for (const [size, filesWithSize] of sizeGroups) {
            if (filesWithSize.length > 1) {
                // Sort to keep the one with the shortest name (likely the original without suffix, or smallest suffix)
                filesWithSize.sort((a, b) => a.length - b.length || a.localeCompare(b));

                const keep = filesWithSize[0];
                const remove = filesWithSize.slice(1);

                for (const fileToRemove of remove) {
                    log(`Removing duplicate image: ${fileToRemove} (same size as ${keep})`);
                    fs.unlinkSync(path.join(imagesDir, fileToRemove));
                    removedCount++;
                }
            }
        }
    }
    log(`Deduplication complete. Removed ${removedCount} duplicate images.`);
}
