import * as fs from 'fs';
import * as path from 'path';
import sizeOf from 'image-size';
import OpenAI from 'openai';
import { OPENROUTER_API_KEY, PRIORITIZATION_MODEL, VISION_MODEL, ENABLE_IMAGE_ANALYSIS } from './config';
import { log } from './logger';
import { IMAGE_DESCRIPTION_PROMPT, IMAGE_PRIORITIZATION_PROMPT } from './prompts';

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://github.com/landing-page-agent',
        'X-Title': 'Landing Page Agent',
    },
});

export interface ImageInfo {
    filename: string;
    width: number;
    height: number;
    description?: string;
    priorityIndex?: number;
    analyzed?: boolean;
}

function getImageDimensions(filePath: string): { width: number; height: number } {
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

async function prioritizeImages(images: ImageInfo[]): Promise<string[]> {
    // TODO: Dont tell the model to return if fewer than 20, just let it prioritize the images it has and then programmatically only use the first 20.
    log('Prioritizing images...');
    const imagesList = images.map(img => `- ${img.filename} (${img.width}x${img.height})`).join('\n');
    const prompt = IMAGE_PRIORITIZATION_PROMPT(imagesList);

    try {
        const completion = await openai.chat.completions.create({
            model: PRIORITIZATION_MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        });

        const content = completion.choices[0].message.content;
        if (!content) return [];

        // Handle potential JSON wrapping
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            // Sometimes models return markdown code blocks
            const jsonMatch = content.match(/```json\n([\s\S] *?) \n```/) || content.match(/\{[\s\S]*\}/) || content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0] || jsonMatch[1]);
            }
        }

        if (Array.isArray(parsed)) {
            return parsed;
        } else if (parsed && Array.isArray(parsed.filenames)) {
            return parsed.filenames;
        } else if (parsed && Array.isArray(parsed.images)) {
            return parsed.images;
        }

        // If it's an object with keys, try to find an array
        if (typeof parsed === 'object') {
            const values = Object.values(parsed);
            const arrayVal = values.find(v => Array.isArray(v));
            if (arrayVal) return arrayVal as string[];
        }

        return [];

    } catch (e) {
        log(`Error prioritizing images: ${e} `);
        return images.slice(0, 20).map(img => img.filename); // Fallback
    }
}

async function describeImage(image: ImageInfo, outputDir: string): Promise<{ description: string }> {
    const imagePath = path.join(outputDir, 'images', image.filename);

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(image.filename).substring(1);
    const dataUrl = `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${base64Image}`;

    const prompt = IMAGE_DESCRIPTION_PROMPT;

    try {
        const completion = await openai.chat.completions.create({
            model: VISION_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: dataUrl,
                            },
                        },
                    ],
                },
            ],
            response_format: { type: 'json_object' },
        });

        const content = completion.choices[0].message.content;
        if (!content) return { description: 'Failed to analyze' };

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        return {
            description: parsed?.description || 'No description',
        };

    } catch (e) {
        log(`Error describing image ${image.filename}: ${e} `);
        return { description: 'Error during analysis' };
    }
}

function generateImageDescriptionFile(images: ImageInfo[], outputDir: string) {
    let content = 'Image Files Description\n\nImages are in images/ folder.\n\n';

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

    fs.writeFileSync(path.join(outputDir, 'image-files-description.txt'), content);
    log(`Generated image-files-description.txt`);
}

export async function analyzeImages(outputDir: string) {
    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) {
        log('No images directory found.');
        return;
    }

    const files = fs.readdirSync(imagesDir).filter(file => /\.(jpg|jpeg|png|webp|svg)$/i.test(file));
    log(`Found ${files.length} images to analyze.`);

    const images: ImageInfo[] = files.map(file => {
        const dims = getImageDimensions(path.join(imagesDir, file));
        return {
            filename: file,
            width: dims.width,
            height: dims.height,
            analyzed: false
        };
    });

    // Filter out images with odd ratios
    const filteredDir = path.join(imagesDir, 'filtered_out');
    if (!fs.existsSync(filteredDir)) {
        fs.mkdirSync(filteredDir);
    }

    const validImages: ImageInfo[] = [];

    for (const img of images) {
        // Skip filter if dimensions are missing (e.g. some SVGs)
        if (img.width === 0 || img.height === 0) {
            validImages.push(img);
            continue;
        }

        const ratio = img.width / img.height;
        // Filter if ratio is > 3.5 (very wide) or < 1/3.5 (very tall)
        const isOddRatio = ratio > 3.5 || ratio < (1 / 3.5);

        if (isOddRatio) {
            try {
                const oldPath = path.join(imagesDir, img.filename);
                const newPath = path.join(filteredDir, img.filename);
                fs.renameSync(oldPath, newPath);
                log(`Filtered out ${img.filename} (ratio: ${ratio.toFixed(2)})`);
            } catch (e) {
                log(`Error moving filtered file ${img.filename}: ${e}`);
                // If move fails, keep it in the list to avoid crashing, but maybe mark it? 
                // For now, just keep it.
                validImages.push(img);
            }
        } else {
            validImages.push(img);
        }
    }

    log(`Filtered ${images.length - validImages.length} images. Proceeding with ${validImages.length} images.`);

    if (ENABLE_IMAGE_ANALYSIS) {
        // 1. Prioritize
        const topImageNames = await prioritizeImages(validImages);
        log(`Prioritized ${topImageNames.length} images.`);

        // 2. Describe top images
        for (const img of validImages) {
            const priorityIndex = topImageNames.indexOf(img.filename);
            if (priorityIndex !== -1) {
                log(`Analyzing ${img.filename}...`);
                const result = await describeImage(img, outputDir);
                img.description = result.description;
                img.priorityIndex = priorityIndex;
                img.analyzed = true;
            }
        }
    } else {
        log('Image analysis disabled via config.');
    }

    // 3. Generate Report
    generateImageDescriptionFile(validImages, outputDir);
}


