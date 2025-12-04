import OpenAI from 'openai';
import { OPENROUTER_API_KEY, PRIORITIZATION_MODEL } from '../config';
import { log } from '../logger';
import { IMAGE_PRIORITIZATION_PROMPT } from '../prompts';
import { ImageInfo } from './types';

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://github.com/landing-page-agent',
        'X-Title': 'Landing Page Agent',
    },
});

export async function prioritizeImages(images: ImageInfo[]): Promise<string[]> {
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
