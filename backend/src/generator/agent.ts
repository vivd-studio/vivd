import * as fs from 'fs';
import { log } from './logger';
import { extractHtmlFromText } from './utils';
import { OPENROUTER_API_KEY, GENERATION_MODEL } from './config';
import { openai } from './client';

export interface GenerationAgent {
    generate(input: {
        prompt: string;
        outputDir: string;
        screenshotPath?: string;
        referenceImagePaths?: string[];
    }): Promise<void>;
}

export class OpenRouterAgent implements GenerationAgent {
    async generate(input: { prompt: string; outputDir: string; screenshotPath?: string; referenceImagePaths?: string[]; }): Promise<void> {
        if (!OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY is not set');
        }

        log('Starting HTML generation with OpenRouter...');

        let attempts = 0;
        const maxRetries = 1;

        while (attempts <= maxRetries) {
            attempts++;
            try {
                if (attempts > 1) {
                    log(`Attempt ${attempts}/${maxRetries + 1}: Retrying generation...`);
                }

                const contentParts: any[] = [{ type: 'text', text: input.prompt }];

                if (input.screenshotPath && fs.existsSync(input.screenshotPath)) {
                    const screenshotBuffer = fs.readFileSync(input.screenshotPath);
                    const screenshotBase64 = screenshotBuffer.toString('base64');
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: `data:image/png;base64,${screenshotBase64}` }
                    });
                }

                for (const imgPath of input.referenceImagePaths || []) {
                    if (!fs.existsSync(imgPath)) continue;
                    const buffer = fs.readFileSync(imgPath);
                    const base64 = buffer.toString('base64');
                    const ext = imgPath.split('.').pop()?.toLowerCase() || 'png';
                    const mime =
                        ext === 'jpg' || ext === 'jpeg'
                            ? 'jpeg'
                            : ext === 'webp'
                                ? 'webp'
                                : 'png';
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: `data:image/${mime};base64,${base64}` }
                    });
                }

                const completion = await openai.chat.completions.create({
                    model: GENERATION_MODEL,
                    messages: [{ role: 'user', content: contentParts }],
                    reasoning_effort: 'high',
                });

                const content = completion.choices[0].message.content;
                const html = this.extractContent(content);

                if (html) {
                    const outputPath = `${input.outputDir}/index.html`;
                    const cleanHtml = extractHtmlFromText(html);
                    fs.writeFileSync(outputPath, cleanHtml);
                    log(`Generated index.html in ${input.outputDir}`);
                    return; // Success, exit the loop
                } else {
                    log(`Warning: No HTML content extracted from response on attempt ${attempts}`);
                    log(`Full response content: ${content}`);
                    log(`Full completion object: ${JSON.stringify(completion, null, 2)}`);

                    if (attempts > maxRetries) {
                        log('Error: No content generated from OpenRouter after all retries');
                    }
                }
            } catch (error) {
                log(`Error during generation attempt ${attempts}: ${error}`);
                if (attempts > maxRetries) {
                    throw error;
                }
            }
        }
    }

    private extractContent(content: string | null | any[]): string {
        if (!content) return '';

        let contentString = '';
        if (typeof content === 'string') {
            contentString = content;
        } else if (Array.isArray(content)) {
            contentString = (content as any[]).map((item: any) => {
                if (item.type === 'text') return item.text;
                return '';
            }).join('');
        }
        return contentString;
    }
}
