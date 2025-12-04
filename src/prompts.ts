export const OPEN_ROUTER_LANDING_PAGE_PROMPT = (text: string, imagesSection: string) => {
    return `Create a new, modern, beautiful, fully-fledged, high-converting landing page for the company described in the text below. 
You will receive a screenshot of the company's current brand, which is probably a little outdated.
Use the attached screenshot for visual context of their current brand, but feel free to improve the design.
Use the best practices of modern web design, for example adding scroll-triggered "appear animations" (e.g., fade-in-up) to elements as they enter the viewport, typical of modern landing pages.
Put everything inside a single index.html file. 
Output ONLY the raw HTML code for the new index.html file. 

${imagesSection}

Current Text on the website: 
The text below contains content from the main page and potentially several subpages (e.g. About, Contact, Team).
Use this content to build a comprehensive landing page. You can decide which information is most relevant for the main page.
${text} 
`;
};

export const LOCAL_AGENT_LANDING_PAGE_PROMPT = (text: string, imagesSection: string) => {
    return `Create a new, modern, beautiful, fully-fledged, high-converting landing page for the company described in the text below. 
You will receive a screenshot of the company's current brand, which is probably a little outdated.
Use the attached screenshot for visual context of their current brand, but feel free to improve the design.
Use the best practices of modern web design, for example adding scroll-triggered "appear animations" (e.g., fade-in-up) to elements as they enter the viewport, typical of modern landing pages.
The screenshot is at ./screenshot.png
Put everything inside a single index.html file. 

${imagesSection}

Current Text on the website: 
The text below contains content from the main page and potentially several subpages (e.g. About, Contact, Team).
Use this content to build a comprehensive landing page. You can decide which information is most relevant for the main page.
${text} 
`;
};

export const IMAGE_PRIORITIZATION_PROMPT = (imagesList: string) => `
I have a list of images from a website. I need to identify the 20 most relevant images that could be used for a new website design or are meaningful for the customer's brand.

Heuristics:
- Prefer images with standard aspect ratios (4:3, 16:9, 1:1).
- Avoid very long and thin images (e.g. banners, dividers) as they are likely not relevant content.
- Check if the Filename indicates the content of the image (e.g. "hero.jpg", "product.jpg").

Here is the list of images with their dimensions:
${imagesList}

Please return a JSON array of strings containing ONLY the filenames of the top 20 most relevant images, in order of importance (most relevant first).
If there are fewer than 20 images, return all of them in order of importance.
Example: ["image1.jpg", "hero_banner.png", ...]
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

