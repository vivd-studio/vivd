import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import {
  OPENROUTER_API_KEY,
  ANALYSIS_MODEL,
  HERO_GENERATION_MODEL,
} from "./config";
import { log } from "./logger";
import { cleanText, downloadImage, saveImageBuffer } from "./utils";
import { getTopImages } from "./image_analyzer/utils";
import { openai } from "./client";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "./vivdPaths";

export async function generateHeroPrompt(
  text: string,
  imageDescriptions: string
): Promise<{ prompt: string; selected_images: string[] }> {
  const prompt = `
You are a creative director for a top-tier web design agency.
Your goal is to write a prompt for an AI image generator to create a stunning, professional Hero Image for a client's landing page.

Context:
Client Website Text:
${text.substring(0, 2000)}

Available Brand Images (Descriptions):
${imageDescriptions}

Instructions:
Analyze the client's business type, brand, and core offering. This could be anything: a product-based company, a service provider (e.g., doctor, marketing agency), a venue (e.g., hotel, restaurant), or an institution (e.g., school), etc.
Think about what visual representation would best capture the essence and professionalism of this specific client.
The image should still capture real entities of the client (products, buildings, interior, etc.) so make the image rather a composition of existing images, than something completely new.
Select the 3-6 most relevant and high-quality images from the list above that would be best for a hero composition.
The prompt should explicitly describe a professional composition that incorporates the selected images (if any).
The image should look like a real, high-end professional photo.
DO NOT ask the model to include text, words or logos. The image should be purely visual. Also try and avoid describing people or faces unless they are central to the selected images (e.g. a doctor's portrait). Don't explicitly ask to exclude it, just don't mention it at all if not necessary.
Output ONLY a valid JSON object with the following structure:
{
  "prompt": "The detailed image generation prompt",
  "selected_images": ["filename1.jpg", "filename2.png"]
}
    `.trim();

  const completion = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  try {
    const content = completion.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);
    return {
      prompt: parsed.prompt || "",
      selected_images: Array.isArray(parsed.selected_images)
        ? parsed.selected_images
        : [],
    };
  } catch (e) {
    log(`Error parsing hero prompt JSON: ${e}`);
    return { prompt: "", selected_images: [] };
  }
}

export async function generateImage(
  prompt: string,
  inputImages: string[],
  outputDir: string
): Promise<string | null> {
  const messages: any[] = [
    {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  ];

  // Add input images
  for (const imgName of inputImages) {
    const imgPath = path.join(outputDir, "images", imgName);
    if (fs.existsSync(imgPath)) {
      const buffer = fs.readFileSync(imgPath);
      const base64 = buffer.toString("base64");
      const ext = path.extname(imgName).substring(1);
      const mimeType = ext === "svg" ? "svg+xml" : ext;

      messages[0].content.push({
        type: "image_url",
        imageUrl: {
          url: `data:image/${mimeType};base64,${base64}`,
        },
      });
    }
  }

  log(`Sending generation request to ${HERO_GENERATION_MODEL}...`);
  log(`Selected images: ${inputImages.join(", ")}`);

  try {
    // Use direct Axios call to OpenRouter to ensure custom parameters are passed correctly
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: HERO_GENERATION_MODEL,
        messages: messages,
        modalities: ["image", "text"],
        image_config: {
          aspect_ratio: "16:9", // Or maybe 21:9?
        },
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/vivd",
          "X-Title": "Vivd",
        },
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
        let content = "";
        if (typeof message.content === "string") {
          content = message.content;
        } else if (Array.isArray(message.content)) {
          // Extract text parts
          content = message.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
        }

        // Check for Markdown image link ![alt](url)
        const match = content.match(/\!\[.*?\]\((.*?)\)/);
        if (match) return match[1];
        if (content.startsWith("http")) return content;
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

async function saveImage(
  urlOrBase64: string,
  outputDir: string
): Promise<string | null> {
  const filename = "generated_hero.webp";
  const outputPath = path.join(outputDir, "images", filename);

  try {
    if (urlOrBase64.startsWith("http")) {
      await downloadImage(urlOrBase64, outputPath);
    } else {
      let buffer: Buffer;

      if (urlOrBase64.startsWith("data:image")) {
        const base64Data = urlOrBase64.replace(/^data:image\/\w+;base64,/, "");
        buffer = Buffer.from(base64Data, "base64");
      } else {
        // Assume raw base64
        buffer = Buffer.from(urlOrBase64, "base64");
      }

      await saveImageBuffer(buffer, outputPath);
    }
    return filename;
  } catch (e) {
    log(`Error saving image: ${e}`);
    return null;
  }
}

export async function createHeroImage(outputDir: string) {
  log("Starting Hero Image Creation...");

  const textPath = getVivdInternalFilesPath(outputDir, "website_text.txt");
  if (!fs.existsSync(textPath)) {
    log("No website text found, skipping hero creation.");
    return;
  }
  const rawText = fs.readFileSync(textPath, "utf-8");
  const text = cleanText(rawText);

  const topImages = getTopImages(outputDir);
  let imageDescriptions = "";

  const descriptionPath = getVivdInternalFilesPath(
    outputDir,
    "image-files-description.txt"
  );
  if (fs.existsSync(descriptionPath)) {
    imageDescriptions = fs.readFileSync(descriptionPath, "utf-8");
  } else {
    imageDescriptions = topImages.join("\n");
  }

  // Step 1: Generate Prompt and Select Images
  log("Generating prompt and selecting images for hero image...");
  const { prompt: heroPrompt, selected_images: selectedImages } =
    await generateHeroPrompt(text, imageDescriptions);

  if (!heroPrompt) {
    log("Failed to generate hero prompt.");
    return;
  }

  log(`Generated Prompt: ${heroPrompt}`);
  log(`Selected Images: ${selectedImages.join(", ")}`);

  // Basic validation to ensure selected images are actually in the top set (optional but good for safety)
  // We can filter selectedImages to ensure they exist in outputDir/images
  const validSelectedImages = selectedImages.filter((img) =>
    fs.existsSync(path.join(outputDir, "images", img))
  );

  // Step 2: Generate Image
  log("Generating image with OpenRouter...");
  let imageUrl = await generateImage(
    heroPrompt,
    validSelectedImages,
    outputDir
  );

  if (!imageUrl) {
    log(
      "First attempt failed or returned no image. Retrying image generation..."
    );
    imageUrl = await generateImage(heroPrompt, validSelectedImages, outputDir);
  }

  if (imageUrl) {
    // Step 3: Save
    const filename = await saveImage(imageUrl, outputDir);

    if (filename) {
      log(`Saved hero image to ${filename}`);

      // Step 4: Update Description File
      ensureVivdInternalFilesDir(outputDir);
      const descFile = getVivdInternalFilesPath(
        outputDir,
        "image-files-description.txt"
      );
      const newEntry = `- ${filename} (Generated) - A professionally generated hero image based on the client's brand: ${heroPrompt.replace(
        /\n/g,
        " "
      )}\n`;

      if (fs.existsSync(descFile)) {
        const currentContent = fs.readFileSync(descFile, "utf-8");
        fs.writeFileSync(descFile, newEntry + currentContent);
      } else {
        fs.writeFileSync(descFile, newEntry);
      }
    }
  } else {
    log("Failed to generate hero image.");
  }
}
