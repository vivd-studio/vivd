import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import { log } from './logger';
import { OPENROUTER_API_KEY, GENERATION_MODEL, LOCAL_AGENT_COMMAND, LOCAL_GENERATION_MODEL, NAVIGATION_MODEL } from './config';

export interface GenerationAgent {
    generate(
        prompt: string,
        screenshotPath: string,
        outputDir: string
    ): Promise<void>;

    analyzeNavigation(links: { text: string, url: string }[]): Promise<string[]>;
}

export class OpenRouterAgent implements GenerationAgent {
    async generate(prompt: string, screenshotPath: string, outputDir: string): Promise<void> {
        if (!OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY is not set');
        }

        const openai = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: OPENROUTER_API_KEY,
        });

        const screenshotBuffer = fs.readFileSync(screenshotPath);
        const screenshotBase64 = screenshotBuffer.toString('base64');

        log('Sending request to OpenRouter...');
        log(`Prompt sent to agent: \n${prompt}`);

        const completion = await openai.chat.completions.create({
            model: GENERATION_MODEL,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt
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
        const html = this.extractContent(content);

        if (html) {
            const outputPath = path.join(outputDir, 'index.html');
            // Extract HTML if wrapped in markdown code blocks
            const cleanHtml = html.replace(/```html/g, '').replace(/```/g, '');
            fs.writeFileSync(outputPath, cleanHtml);
            log(`Generated index.html in ${outputDir}`);
        } else {
            log('No content generated from OpenRouter');
        }
    }

    async analyzeNavigation(links: { text: string, url: string }[]): Promise<string[]> {
        if (!OPENROUTER_API_KEY) {
            log('OPENROUTER_API_KEY is not set, skipping navigation analysis.');
            return [];
        }

        const openai = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: OPENROUTER_API_KEY,
        });

        const prompt = `
        You are a web scraper helper. I have a list of links from a website's navigation menu.
        I need to identify the most important subpages to scrape to understand the business better.
        Prioritize pages like: "About Us", "Team", "Contact", "Services", "Products", "Pricing".
        Ignore pages like: "Login", "Sign Up", "Terms", "Privacy", "Social Media Links".
        
        Return a JSON array of the URLs of the top 3-5 most relevant pages.
        
        Links:
        ${JSON.stringify(links.slice(0, 50), null, 2)}
        
        Output JSON only.
        `;

        try {
            const completion = await openai.chat.completions.create({
                model: NAVIGATION_MODEL, // Use a fast model for this
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: { type: 'json_object' }
            });

            const content = completion.choices[0].message.content;
            if (!content) return [];

            const parsed = JSON.parse(content);
            // Handle if it returns { urls: [...] } or just [...]
            if (Array.isArray(parsed)) return parsed;
            if (parsed.urls && Array.isArray(parsed.urls)) return parsed.urls;
            return [];

        } catch (e) {
            log(`Error analyzing navigation: ${e}`);
            return [];
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

export class LocalCursorAgent implements GenerationAgent {
    async generate(prompt: string, screenshotPath: string, outputDir: string): Promise<void> {
        log(`Executing local agent: ${LOCAL_AGENT_COMMAND}`);

        try {
            const subprocess = execa(LOCAL_AGENT_COMMAND, ['--model', LOCAL_GENERATION_MODEL, '-p'], {
                cwd: outputDir,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            log(`Prompt sent to agent: \n${prompt}`);

            if (subprocess.stdin) {
                subprocess.stdin.write(prompt);
                subprocess.stdin.end();
            }

            if (subprocess.stdout) {
                subprocess.stdout.pipe(process.stdout);
            }

            if (subprocess.stderr) {
                subprocess.stderr.pipe(process.stderr);
            }

            await subprocess;
            log('Local agent finished execution.');
        } catch (error: any) {
            throw new Error(`Local agent process failed: ${error.message}`);
        }
    }

    async analyzeNavigation(links: { text: string, url: string }[]): Promise<string[]> {
        // Local agent doesn't support this yet, fallback to heuristic or empty
        log('Local agent does not support navigation analysis yet.');
        return [];
    }
}
