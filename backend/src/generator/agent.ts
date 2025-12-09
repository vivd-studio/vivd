import * as fs from 'fs';
import * as path from 'path';
import { execa } from 'execa';
import { log } from './logger';
import { extractHtmlFromText } from './utils';
import { OPENROUTER_API_KEY, GENERATION_MODEL, LOCAL_AGENT_COMMAND, LOCAL_GENERATION_MODEL } from './config';
import { openai } from './client';

export interface GenerationAgent {
    generate(
        prompt: string,
        screenshotPath: string,
        outputDir: string
    ): Promise<void>;
}

export class OpenRouterAgent implements GenerationAgent {
    async generate(prompt: string, screenshotPath: string, outputDir: string): Promise<void> {
        if (!OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY is not set');
        }


        const screenshotBuffer = fs.readFileSync(screenshotPath);
        const screenshotBase64 = screenshotBuffer.toString('base64');

        log('Sending request to OpenRouter...');


        let attempts = 0;
        const maxRetries = 1;

        while (attempts <= maxRetries) {
            attempts++;
            try {
                if (attempts > 1) {
                    log(`Attempt ${attempts}/${maxRetries + 1}: Retrying generation...`);
                }

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
                    ],
                    reasoning_effort: 'high',
                });

                const content = completion.choices[0].message.content;
                const html = this.extractContent(content);

                if (html) {
                    const outputPath = path.join(outputDir, 'index.html');
                    const cleanHtml = extractHtmlFromText(html);
                    fs.writeFileSync(outputPath, cleanHtml);
                    log(`Generated index.html in ${outputDir}`);
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

export class LocalCursorAgent implements GenerationAgent {
    async generate(prompt: string, _screenshotPath: string, outputDir: string): Promise<void> {
        log(`Executing local agent: ${LOCAL_AGENT_COMMAND}`);

        try {
            const subprocess = execa(LOCAL_AGENT_COMMAND, ['--model', LOCAL_GENERATION_MODEL, '-p'], {
                cwd: outputDir,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe']
            });



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

}
