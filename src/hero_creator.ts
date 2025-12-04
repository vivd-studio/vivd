import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { OPENROUTER_API_KEY, GENERATION_MODEL, HERO_GENERATION_MODEL } from './config';
import { log } from './logger';
import { cleanText } from './utils';
import { getTopImages } from './image_analyzer/utils';
import { openai } from './client';


async function generateHeroPrompt(text: string, imageDescriptions: string): Promise<string> {
    const prompt = `
You are a creative director for a web design agency.
Your goal is to write a prompt for an AI image generator to create a stunning, professional Hero Image for a client's landing page.

Context:
Client Website Text:
${text.substring(0, 2000)}

Available Brand Images (Descriptions):
${imageDescriptions}

Instructions:
1. Analyze the client's brand and products.
2. Write a DETAILED prompt for an image generation model.
3. The hero image should reflect the client's products, brand, or generally important things for that client.
4. If there are already good product images available in the list above, the prompt should EXPLICITLY ask to combine or feature these core products in a professional composition.
5. The image should look like a real, high-end professional photo.
6. DO NOT ask the model to include text, words or logos. The image should be purely visual. Also try and avoid describing people or faces. Don't explicitly ask to exclude it, just don't mention it at all.
7. Output ONLY the prompt text, nothing else.
    `.trim();

    const completion = await openai.chat.completions.create({
        model: GENERATION_MODEL,
        messages: [{ role: 'user', content: prompt }]
    });

    return completion.choices[0].message.content || '';
}

async function generateImage(prompt: string, inputImages: string[], outputDir: string): Promise<string | null> {
    const messages: any[] = [
        {
            role: 'user',
            content: [
                { type: 'text', text: prompt },
            ]
        }
    ];

    // Add input images
    for (const imgName of inputImages) {
        const imgPath = path.join(outputDir, 'images', imgName);
        if (fs.existsSync(imgPath)) {
            const buffer = fs.readFileSync(imgPath);
            const base64 = buffer.toString('base64');
            const ext = path.extname(imgName).substring(1);
            const mimeType = ext === 'svg' ? 'svg+xml' : ext;

            messages[0].content.push({
                type: 'image_url',
                imageUrl: {
                    url: `data:image/${mimeType};base64,${base64}`
                }
            });
        }
    }

    log(`Sending generation request to ${HERO_GENERATION_MODEL}...`);

    try {
        // Use direct Axios call to OpenRouter to ensure custom parameters are passed correctly
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: HERO_GENERATION_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                modalities: ['image', 'text'],
                image_config: {
                    aspect_ratio: "16:9"
                },
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/landing-page-agent',
                    'X-Title': 'Landing Page Agent',
                }
            }
        );

        const result = response.data;

        if (result.choices && result.choices[0]) {
            const message = result.choices[0].message;

            // Check for images in the special OpenRouter format (snake_case based on user example)
            if (message.images && message.images.length > 0) {
                const imgObj = message.images[0];
                // Handle both snake_case (Gemini) and camelCase (standard OpenRouter/OpenAI)
                const imageUrl = imgObj.image_url?.url || imgObj.imageUrl?.url;

                if (imageUrl) {
                    return imageUrl;
                }
            }

            // Fallback: check content for markdown or URL if the SDK returns it there
            if (message.content) {
                let content = '';
                if (typeof message.content === 'string') {
                    content = message.content;
                } else if (Array.isArray(message.content)) {
                    // Extract text parts
                    content = message.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('');
                }

                // Check for Markdown image link ![alt](url)
                const match = content.match(/\!\[.*?\]\((.*?)\)/);
                if (match) return match[1];
                if (content.startsWith('http')) return content;
            }
        }

        log(`No image found in response.`);
        return null;

    } catch (e: any) {
        log(`Error generating hero image: ${e.message}`);
        if (e.response) {
            log(`Response: ${JSON.stringify(e.response.data)}`);
        }
        return null;
    }
}

async function saveImage(urlOrBase64: string, outputDir: string): Promise<string | null> {
    const filename = 'generated_hero.png';
    const outputPath = path.join(outputDir, 'images', filename);

    try {
        if (urlOrBase64.startsWith('http')) {
            const response = await axios.get(urlOrBase64, { responseType: 'arraybuffer' });
            fs.writeFileSync(outputPath, response.data);
        } else if (urlOrBase64.startsWith('data:image')) {
            const base64Data = urlOrBase64.replace(/^data:image\/\w+;base64,/, "");
            fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
        } else {
            // Assume raw base64?
            fs.writeFileSync(outputPath, Buffer.from(urlOrBase64, 'base64'));
        }
        return filename;
    } catch (e) {
        log(`Error saving image: ${e}`);
        return null;
    }
}

export async function createHeroImage(outputDir: string) {
    log('Starting Hero Image Creation...');

    const textPath = path.join(outputDir, 'website_text.txt');
    if (!fs.existsSync(textPath)) {
        log('No website text found, skipping hero creation.');
        return;
    }
    const rawText = fs.readFileSync(textPath, 'utf-8');
    const text = cleanText(rawText);

    const topImages = getTopImages(outputDir);
    let imageDescriptions = '';

    const descriptionPath = path.join(outputDir, 'image-files-description.txt');
    if (fs.existsSync(descriptionPath)) {
        imageDescriptions = fs.readFileSync(descriptionPath, 'utf-8');
    } else {
        imageDescriptions = topImages.join('\n');
    }

    // Step 1: Generate Prompt
    log('Generating prompt for hero image...');
    const heroPrompt = await generateHeroPrompt(text, imageDescriptions);
    log(`Generated Prompt: ${heroPrompt}`);

    // Step 2: Generate Image
    log('Generating image with OpenRouter...');
    let imageUrl = await generateImage(heroPrompt, topImages, outputDir);

    if (!imageUrl) {
        log('First attempt failed or returned no image. Retrying image generation...');
        imageUrl = await generateImage(heroPrompt, topImages, outputDir);
    }

    if (imageUrl) {
        // Step 3: Save
        const filename = await saveImage(imageUrl, outputDir);

        if (filename) {
            log(`Saved hero image to ${filename}`);

            // Step 4: Update Description File
            const descFile = path.join(outputDir, 'image-files-description.txt');
            const newEntry = `- ${filename} (Generated) - A professionally generated hero image based on the client's brand: ${heroPrompt.replace(/\n/g, ' ')}\n`;

            // Prepend or Append? "include it in the images description".
            // It's good to put it at the top or with high priority.
            // AnalyzeImages sorts by analyzed/priority.
            // I'll prepend it to the text content so it's seen first.

            if (fs.existsSync(descFile)) {
                const currentContent = fs.readFileSync(descFile, 'utf-8');
                fs.writeFileSync(descFile, newEntry + currentContent);
            } else {
                fs.writeFileSync(descFile, newEntry);
            }

        }
    } else {
        log('Failed to generate hero image.');
    }
}

