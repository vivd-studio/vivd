export const OPEN_ROUTER_LANDING_PAGE_PROMPT = (
  text: string,
  imagesSection: string
) => {
  return `Create a new, modern, beautiful, fully-fledged, high-converting landing page for the company described in the text below. 
You will receive a screenshot of the company's current website, which is probably a little outdated, as well as the current text on the website.
Use the attached screenshot for visual context of their current brand. 
Think about how to improve the current design, colors, typography, effects, and layout. Use subtle appear animations on scroll. Keep it professional and fitting for the company.
Think about the vibe and artstyle of the website, should it be modern, professional, playful, minimal, sleek, scandinavian, artsy, neo-brutalism, neon, dark, light, etc.
Don't make the Headline text over the hero image too cringe - if there is something catchy on the page already, take that otherwise keep it professional.
Use the current text to build a comprehensive landing page. Think about which information is most relevant for the main page and where the information should be placed.
Put everything inside a single index.html file. 
Output ONLY the raw HTML code for the new index.html file. 

${imagesSection}

Current Text on the website: 
The text below contains content from the main page and potentially several subpages (e.g. About, Contact, Team).
Use this content to build a comprehensive landing page. You can decide which information is most relevant for the main page.
${text} 
`;
};

export const OPEN_ROUTER_SCRATCH_PAGE_PROMPT = (
  text: string,
  imagesSection: string,
  stylePreset?: string,
  stylePalette?: string[],
  styleMode?: "exact" | "reference",
  siteTheme?: "dark" | "light",
  referencesSection?: string
) => {
  const styleLine = stylePreset ? `Style preset: ${stylePreset}\n` : "";
  const paletteLine =
    stylePreset && stylePalette?.length
      ? `Color tokens (hex): ${stylePalette.join(", ")}\n`
      : "";
  const modeLine =
    stylePreset && styleMode
      ? `Color token usage: ${
          styleMode === "exact"
            ? "EXACT (please use exactly these colors)"
            : "REFERENCE (these colors are just for inspiration and don't need to exactly match)"
        }\n`
      : "";
  const themeLine = siteTheme
    ? `Theme preference: ${siteTheme.toUpperCase()}`
    : "";
  const styleBlock =
    styleLine || themeLine
      ? `${styleLine}${paletteLine}${modeLine}${themeLine}\n`
      : "";
  const refs = referencesSection ? `${referencesSection}\n\n` : "";
  return `Create a new, modern, beautiful, fully-fledged, high-converting landing page for the business described in the text below.
This is a "start from scratch" project: there is no source website screenshot.
You will also receive reference screenshots/images of designs the user likes. Use them as visual inspiration for layout, typography, spacing, components, and overall vibe.
Use Tailwind CSS (inline or CDN) and modern landing page best practices (layout, typography, spacing, subtle scroll-appear animations).
${
  stylePreset
    ? "Use the provided style preset and color tokens as direction."
    : ""
}${siteTheme ? ` Build a ${siteTheme} themed website.` : ""}
Put everything inside a single index.html file.
Output ONLY the raw HTML code for the new index.html file.

${styleBlock}${refs}${imagesSection}

Business brief:
${text}
`;
};

export const IMAGE_PRIORITIZATION_PROMPT = (imagesList: string) => `
I have a list of images from a website. I need to order them by relevance, with the most relevant images first.
From the aspect ratio, the resolution and the filename, try to identify the most relevant images, that could be used for a new website design or are meaningful for the customer's brand.

Here is the list of images with their dimensions:
${imagesList}

Please return a JSON array of strings containing ALL filenames from the list, ordered by importance (most relevant first).
Example: ["hero_banner.png", "logo.jpg", "product_1.jpg", ...]
`;

export const IMAGE_DESCRIPTION_PROMPT = `
Analyze this website image.
Provide a short and concise description of the image content in 1 sentence. Don't start with "The image shows...", start right with what it is. 

Example: "A person holding a phone" 

Return a JSON object: { "description": "string" }
`;

export const getImagesSection = (imageList: string, isAnalyzed: boolean) => {
  if (isAnalyzed) {
    return `Those are the ALL images that were on the old website. They are located in the "images" folder. 
They have not been filtered, so all of them might be good, all of them might be bad or something in between. 
You can use them if they fit the design, but you don't have to. Use the descriptions to choose the images. Keep in mind the resolution of the images, and avoid using small images for large spaces.

${imageList}`;
  } else {
    return `The images in the /images folder are listed below. 
You can use them if they fit the design, but you don't have to.
${imageList}`;
  }
};
