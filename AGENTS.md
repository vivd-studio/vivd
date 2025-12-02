# Landing Page Agent

This project is an automated agent that scrapes websites and generates modern landing pages using AI.

## How it works
1. **Scrapes** a target URL for text, images, and a screenshot using Puppeteer.
2. **Analyzes** the content and current brand visual.
3. **Generates** a new, high-converting landing page (HTML/Tailwind) via OpenRouter API.

## Testing Note
> [!IMPORTANT]
> **Do not run tests on every change.**
> The workflow is long-running and uses paid API calls. Running tests frequently can be pricey and time-consuming.
