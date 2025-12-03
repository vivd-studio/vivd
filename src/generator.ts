import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { OPENROUTER_API_KEY } from './config';

export async function generateLandingPage(outputDir: string) {
    if (!OPENROUTER_API_KEY) return;

    const openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: OPENROUTER_API_KEY,
    });

    const text = fs.readFileSync(path.join(outputDir, 'website_text.txt'), 'utf-8').substring(0, 10000); // Limit text context
    const screenshotBuffer = fs.readFileSync(path.join(outputDir, 'screenshot.png'));
    const screenshotBase64 = screenshotBuffer.toString('base64');

    log('Sending request to OpenRouter...');

    try {
        const completion = await openai.chat.completions.create({
            model: 'google/gemini-3-pro-preview',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Create a new, modern, beautiful, high-converting landing page for the company described in the text below. \n\n` +
                                `You will receive a screenshot of the company's current brand, which is probably a little outdated. \n\n` +
                                `Use the attached screenshot for visual context of their current brand, but feel free to improve the design. \n\n` +
                                `Put everything inside a single index.html file. \n\n` +
                                `Output ONLY the raw HTML code for the new index.html file. \n\n` +
                                `Those are the ALL images that were on the old website. They are located in the "images" folder. \n\n` +
                                `They have not been filtered, so all of them might be good, all of them might be bad or something in between. \n\n` +
                                `You can use them if they fit the design, but you don't have to. Use the descriptions to choose the images. \n\n` +
                                (fs.existsSync(path.join(outputDir, 'image-files-description.txt'))
                                    ? fs.readFileSync(path.join(outputDir, 'image-files-description.txt'), 'utf-8')
                                    : fs.readdirSync(path.join(outputDir, 'images')).map(file => `- images/${file}`).join('\n')) +
                                `\n\nCurrent Text on the website: \n${text} \n\n`
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${screenshotBase64}`
                            }
                        }
                    ]
                }
            ]
        });

        const content = completion.choices[0].message.content;
        let contentString = '';
        if (typeof content === 'string') {
            contentString = content;
        } else if (Array.isArray(content)) {
            contentString = (content as any[]).map((item: any) => {
                if (item.type === 'text') return item.text;
                return '';
            }).join('');
        }

        // Extract HTML if wrapped in markdown code blocks
        const html = contentString.replace(/```html/g, '').replace(/```/g, '') || '';

        fs.writeFileSync(path.join(outputDir, 'index.html'), html);
        log(`Generated index.html in ${outputDir}`);
    } catch (error: any) {
        log(`Error generating landing page: ${error.message}`);
        if (error.response) {
            log(`Response data: ${JSON.stringify(error.response.data)}`);
        }
    }
}
