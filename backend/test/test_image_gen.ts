import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const HERO_GENERATION_MODEL = 'google/gemini-2.5-flash-image-preview'; // User switched to 3-pro in editor, but let's verify config

if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set');
    process.exit(1);
}

async function testImageGeneration() {
    console.log('Testing image generation with fetch...');
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: HERO_GENERATION_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: 'Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme',
                    },
                ],
                modalities: ['image', 'text'],
                image_config: {
                    aspect_ratio: '16:9',
                },
            }),
        });

        const result = await response.json() as any;

        console.log('Response received');
        // console.log(JSON.stringify(result, null, 2));

        if (result.choices) {
            const message = result.choices[0].message;
            if (message.images) {
                message.images.forEach((image: any, index: number) => {
                    const imageUrl = image.image_url.url;
                    console.log(`Generated image ${index + 1}: ${imageUrl.substring(0, 50)}...`);
                    
                    if (imageUrl.startsWith('data:image')) {
                        try {
                            const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
                            const buffer = Buffer.from(base64Data, 'base64');
                            const filePath = path.join(__dirname, `generated_image_${index + 1}.png`);
                            fs.writeFileSync(filePath, buffer);
                            console.log(`Saved image to: ${filePath}`);
                        } catch (err) {
                            console.error('Error saving image:', err);
                        }
                    }
                });
            } else {
                console.log("No images in message");
                if (message.content) {
                    console.log("Content:", message.content);
                }
            }
        } else {
            console.log("No choices in result", result);
        }

    } catch (error: any) {
        console.error('Error:', error);
    }
}

testImageGeneration();
