import * as fs from 'fs';
import OpenAI from 'openai';
import { log } from '../logger';
import { OPENROUTER_API_KEY, NAVIGATION_MODEL } from '../config';

export async function extractNavigationLinks(screenshotPath: string): Promise<string[]> {
    log('Extracting navigation links from screenshot...');

    if (!fs.existsSync(screenshotPath)) {
        log(`Screenshot not found at ${screenshotPath}`);
        return [];
    }

    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64Image}`;

    const prompt = `
    Analyze this screenshot of a website header/navigation.
    Identify all the navigation links visible (e.g., Home, Contact, About, Services, Team, Praxis, Behandlung, etc.).
    Return a JSON array of strings containing the text of these links.
    Example: ["Home", "About Us", "Contact", "Services"]
    Only return the text you see.
    `;

    const openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: OPENROUTER_API_KEY,
        defaultHeaders: {
            'HTTP-Referer': 'https://github.com/landing-page-agent',
            'X-Title': 'Landing Page Agent',
        },
    });

    try {
        const completion = await openai.chat.completions.create({
            model: NAVIGATION_MODEL,
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
        if (!content) return [];

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            const jsonMatch = content.match(/\{[\s\S]*\}/) || content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
        }

        if (Array.isArray(parsed)) {
            return parsed;
        } else if (parsed && Array.isArray(parsed.links)) {
            return parsed.links;
        } else if (parsed && Array.isArray(parsed.navigation)) {
            return parsed.navigation;
        }

        // Fallback: look for any array in values
        if (typeof parsed === 'object') {
            const values = Object.values(parsed);
            const arrayVal = values.find(v => Array.isArray(v));
            if (arrayVal) return arrayVal as string[];
        }

        return [];

    } catch (e) {
        log(`Error extracting navigation links: ${e}`);
        return [];
    }
}

export async function prioritizeNavigationLinks(links: { text: string, url: string }[]): Promise<string[]> {
    if (!OPENROUTER_API_KEY) {
        log('OPENROUTER_API_KEY is not set, skipping prioritization.');
        return links.slice(0, 6).map(l => l.url);
    }

    const openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: OPENROUTER_API_KEY,
    });

    const prompt = `
    You are a web scraper helper. I have a list of links found on a website's navigation menu.
    I need to identify the top 6 most important subpages to scrape to understand the business and its offerings.
    
    Ignore pages like: "Login", "Sign Up", "Terms", "Privacy", "Social Media Links", "Forgot Password".
    
    Return a JSON array of the URLs of the top 6 most relevant pages.
    
    Links:
    ${JSON.stringify(links, null, 2)}
    
    Output JSON only.
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: NAVIGATION_MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;
        if (!content) return links.slice(0, 6).map(l => l.url);

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            const jsonMatch = content.match(/\{[\s\S]*\}/) || content.match(/\[[\s\S]*\]/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.urls)) return parsed.urls;
        if (parsed && Array.isArray(parsed.links)) return parsed.links;

        return links.slice(0, 6).map(l => l.url);

    } catch (e) {
        log(`Error prioritizing links: ${e}`);
        return links.slice(0, 6).map(l => l.url);
    }
}

export async function findLinksMatchingTexts(page: any, texts: string[]): Promise<string[]> {
    log(`Searching for links matching ${texts.length} terms...`);

    return await page.evaluate((texts: string[]) => {
        const links = Array.from(document.querySelectorAll('a'));
        const foundUrls = new Set<string>();
        const lowerTexts = texts.map(t => t.toLowerCase());

        for (const a of links) {
            let match = false;

            // 1. Check innerText
            const text = a.innerText?.trim().toLowerCase();
            if (text && lowerTexts.some(t => text.includes(t))) {
                match = true;
            }

            // 2. Check ID
            if (!match && a.id) {
                const id = a.id.toLowerCase();
                if (lowerTexts.some(t => id.includes(t))) {
                    match = true;
                }
            }

            // 3. Check Image children
            if (!match) {
                const img = a.querySelector('img');
                if (img) {
                    // Check alt
                    if (img.alt && lowerTexts.some(t => img.alt.toLowerCase().includes(t))) {
                        match = true;
                    }
                    // Check id
                    if (!match && img.id && lowerTexts.some(t => img.id.toLowerCase().includes(t))) {
                        match = true;
                    }
                    // Check name
                    if (!match && img.name && lowerTexts.some(t => img.name.toLowerCase().includes(t))) {
                        match = true;
                    }
                }
            }

            if (match) {
                // Resolve URL
                let url = a.href;
                const hrefAttr = a.getAttribute('href');
                if (hrefAttr && !hrefAttr.startsWith('http') && !hrefAttr.startsWith('//') && !hrefAttr.startsWith('javascript:') && !hrefAttr.startsWith('mailto:') && !hrefAttr.startsWith('tel:') && !hrefAttr.startsWith('#')) {
                    try {
                        url = new URL(hrefAttr, window.location.href).href;
                    } catch (e) {
                        // Keep original
                    }
                }

                if (url && url.startsWith('http')) {
                    foundUrls.add(url);
                }
            }
        }
        return Array.from(foundUrls);
    }, texts);
}
