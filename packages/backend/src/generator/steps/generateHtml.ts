import * as fs from "fs";
import * as path from "path";
import { log } from "../logger";
import { cleanText } from "../utils";
import { ENABLE_IMAGE_ANALYSIS } from "../config";
import { getVivdInternalFilesPath } from "../vivdPaths";
import {
  getImagesSection,
  OPEN_ROUTER_LANDING_PAGE_PROMPT,
  OPEN_ROUTER_SCRATCH_PAGE_PROMPT,
} from "../prompts";
import { OpenRouterAgent } from "../agent";
import type { GenerationAgent } from "../agent";
import type { GenerationSource } from "../flows/types";
import type { FlowContext } from "../../services/OpenRouterService";

export interface GenerateHtmlInput {
  outputDir: string;
  source: GenerationSource;
  flowContext?: FlowContext;
  /** Optional hint from the client to influence the HTML generation */
  clientHint?: string;
  scratch?: {
    title?: string;
    businessType?: string;
    stylePreset?: string;
    stylePalette?: string[];
    styleMode?: "exact" | "reference";
    siteTheme?: "dark" | "light";
  };
}

function getReferenceImagePaths(outputDir: string): string[] {
  const refsDir = path.join(outputDir, "references");
  if (!fs.existsSync(refsDir)) return [];

  return fs
    .readdirSync(refsDir)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    .map((file) => path.join(refsDir, file))
    .sort();
}

function buildReferencesSection(
  outputDir: string,
  referenceImagePaths: string[]
) {
  const urlsPath = path.join(outputDir, "references", "urls.txt");
  const urls = fs.existsSync(urlsPath)
    ? fs
        .readFileSync(urlsPath, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  const imagesList = referenceImagePaths
    .slice(0, 6)
    .map((p) => `- ${path.basename(p)}`)
    .join("\n");

  const sections: string[] = [];
  if (urls.length) {
    sections.push(
      `Reference URLs (screenshots attached):\n${urls
        .map((u) => `- ${u}`)
        .join("\n")}`
    );
  }
  if (imagesList) {
    sections.push(`Reference images attached:\n${imagesList}`);
  }

  if (!sections.length) return undefined;
  return sections.join("\n\n");
}

export async function generateHtml(input: GenerateHtmlInput) {
  const agent: GenerationAgent = new OpenRouterAgent();

  const textPath =
    input.source === "scratch"
      ? path.join(input.outputDir, "scratch_brief.txt")
      : getVivdInternalFilesPath(input.outputDir, "website_text.txt");
  if (!fs.existsSync(textPath)) {
    log(`${path.basename(textPath)} not found, skipping generation.`);
    return;
  }

  const rawText = fs.readFileSync(textPath, "utf-8");
  const text = cleanText(rawText).substring(0, 30000);

  const screenshotPath = getVivdInternalFilesPath(
    input.outputDir,
    "screenshot.png"
  );
  const hasScreenshot = fs.existsSync(screenshotPath);

  const descriptionPath = getVivdInternalFilesPath(
    input.outputDir,
    "image-files-description.txt"
  );
  const imageList = fs.existsSync(descriptionPath)
    ? fs.readFileSync(descriptionPath, "utf-8")
    : fs.existsSync(path.join(input.outputDir, "images"))
    ? fs
        .readdirSync(path.join(input.outputDir, "images"))
        .map((file) => `- images/${file}`)
        .join("\n")
    : "";

  const imagesSection = getImagesSection(imageList, ENABLE_IMAGE_ANALYSIS);
  const referenceImagePaths = getReferenceImagePaths(input.outputDir).slice(
    0,
    6
  );
  const referencesSection = buildReferencesSection(
    input.outputDir,
    referenceImagePaths
  );

  const prompt =
    input.source === "url"
      ? OPEN_ROUTER_LANDING_PAGE_PROMPT(text, imagesSection, input.clientHint)
      : OPEN_ROUTER_SCRATCH_PAGE_PROMPT(
          text,
          imagesSection,
          input.scratch?.stylePreset,
          input.scratch?.stylePalette,
          input.scratch?.styleMode,
          input.scratch?.siteTheme,
          referencesSection
        );

  await agent.generate({
    prompt,
    outputDir: input.outputDir,
    screenshotPath: hasScreenshot ? screenshotPath : undefined,
    referenceImagePaths: input.source === "scratch" ? referenceImagePaths : [],
    flowContext: input.flowContext,
  });
}
