import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { OPENROUTER_API_KEY, VISION_MODEL } from '../config';
import { log } from '../logger';
import { IMAGE_DESCRIPTION_PROMPT } from '../prompts';
import { ImageInfo } from './types';

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://github.com/landing-page-agent',
        'X-Title': 'Landing Page Agent',
    },
});

export async function describeImage(image: ImageInfo, outputDir: string): Promise<{ description: string }> {
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
