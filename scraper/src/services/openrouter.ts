import { log } from "../utils/logger.js";
import { parseJsonLoose } from "../utils/json.js";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

const NAVIGATION_MODEL =
  process.env.NAVIGATION_MODEL || "google/gemini-2.5-flash";

export interface NavigationLink {
  text: string;
  url: string;
}

export async function extractNavigationTextsFromHeaderScreenshot(
  headerScreenshotBase64: string
): Promise<string[]> {
  if (!OPENROUTER_API_KEY) return [];

  const dataUrl = `data:image/png;base64,${headerScreenshotBase64}`;
  const prompt = `Analyze this screenshot of a website header/navigation.
Identify all the navigation links visible (e.g., Home, Contact, About, Services, Team, Praxis, Behandlung, etc.).
Return a JSON array of strings containing the text of these links.
Example: ["Home", "About Us", "Contact", "Services"]
Only return the text you see.`;

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/vivd",
        "X-Title": "vivd-scraper",
      },
      body: JSON.stringify({
        model: NAVIGATION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log(`OpenRouter navigation extraction failed: HTTP ${res.status}: ${text}`);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = parseJsonLoose(content);
    if (Array.isArray(parsed)) {
      return parsed.filter((t) => typeof t === "string") as string[];
    }
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed as Record<string, unknown>);
      const arrayVal = values.find((v) => Array.isArray(v));
      if (arrayVal) {
        return (arrayVal as unknown[]).filter(
          (t) => typeof t === "string"
        ) as string[];
      }
    }

    return [];
  } catch (e) {
    log(`OpenRouter navigation extraction error: ${e}`);
    return [];
  }
}

export async function prioritizeNavigationLinks(
  links: NavigationLink[],
  maxPages: number
): Promise<string[]> {
  if (links.length === 0) return [];
  if (!OPENROUTER_API_KEY) return links.slice(0, maxPages).map((l) => l.url);

  const prompt = `You are a web scraper helper. I have a list of links found on a website's navigation menu.
I need to identify the top ${maxPages} most important subpages to scrape to understand the business and its offerings.

Ignore pages like: "Login", "Sign Up", "Terms", "Privacy", "Social Media Links", "Forgot Password".

Return a JSON array of the URLs of the top ${maxPages} most relevant pages.

Links:
${JSON.stringify(links, null, 2)}

Output JSON only.`;

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/vivd",
        "X-Title": "vivd-scraper",
      },
      body: JSON.stringify({
        model: NAVIGATION_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log(`OpenRouter link prioritization failed: HTTP ${res.status}: ${text}`);
      return links.slice(0, maxPages).map((l) => l.url);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return links.slice(0, maxPages).map((l) => l.url);

    const parsed = parseJsonLoose(content);
    if (Array.isArray(parsed)) {
      return (parsed as unknown[])
        .filter((u) => typeof u === "string")
        .slice(0, maxPages) as string[];
    }
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed as Record<string, unknown>);
      const arrayVal = values.find((v) => Array.isArray(v));
      if (arrayVal) {
        return (arrayVal as unknown[])
          .filter((u) => typeof u === "string")
          .slice(0, maxPages) as string[];
      }
    }

    return links.slice(0, maxPages).map((l) => l.url);
  } catch (e) {
    log(`OpenRouter link prioritization error: ${e}`);
    return links.slice(0, maxPages).map((l) => l.url);
  }
}
