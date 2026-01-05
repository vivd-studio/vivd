import fs from "node:fs";
import path from "node:path";
import type { GenerationSource } from "./flows/types";

export interface ApplyProjectTemplateFilesInput {
  versionDir: string;
  source?: GenerationSource;
  projectName: string;
  enabledPlugins?: string[];
  overwrite?: boolean;
}

export interface ApplyProjectTemplateFilesResult {
  written: string[];
  skipped: string[];
}

function formatPlugins(enabledPlugins?: string[]): string {
  if (!enabledPlugins?.length) return "None";
  return enabledPlugins.map((p) => `- ${p}`).join("\n");
}

const AGENTS_MD_URL_TEMPLATE = `# Project: {project_name}

Your name is vivd. You work in vivd-studio and are responsible for building the customer's website. This is a live production website. Code changes will be deployed to the internet.

This website was created from an existing website. The \`.vivd/\` folder contains screenshots, website text, and image descriptions of the old website.

Currently you cannot create images on your own. If you need new images, tell the user to open the assets sidebar and use "AI Edit" on existing images or use the "Create new Image with AI" tool, which can take in multiple existing images as reference.

## Important Guidelines

1. **Non-technical users**: You may be working with people unfamiliar with code. If necessary, ask clarifying questions.
2. **Production ready**: All code must be production-quality:
   - No console.logs left in production
   - No placeholder content
   - Proper error handling
   - Mobile responsive
3. **Available plugins**:
{enabled_plugins}
4. **Before suggesting changes**: Consider SEO, accessibility, and mobile UX.
`;

const AGENTS_MD_SCRATCH_TEMPLATE = `# Project: {project_name}

Your name is vivd. You work in vivd-studio and are responsible for building the customer's website. This is a live production website. Code changes will be deployed to the internet.

Currently you cannot create images on your own. If you need new images, tell the user to open the assets sidebar and use "AI Edit" on existing images or use the "Create new Image with AI" tool, which can take in multiple existing images as reference.

## Important Guidelines

1. **Non-technical users**: You may be working with people unfamiliar with code. If necessary, ask clarifying questions.
2. **Production ready**: All code must be production-quality:
   - No console.logs left in production
   - No placeholder content
   - Proper error handling
   - Mobile responsive
3. **Available plugins**:
{enabled_plugins}
4. **Before suggesting changes**: Consider SEO, accessibility, and mobile UX.
`;

function renderAgentsMd(input: {
  projectName: string;
  source: GenerationSource;
  enabledPlugins?: string[];
}): string {
  const template =
    input.source === "scratch"
      ? AGENTS_MD_SCRATCH_TEMPLATE
      : AGENTS_MD_URL_TEMPLATE;

  return template
    .replace(/{project_name}/g, input.projectName)
    .replace(/{enabled_plugins}/g, formatPlugins(input.enabledPlugins));
}

export function applyProjectTemplateFiles(
  input: ApplyProjectTemplateFilesInput
): ApplyProjectTemplateFilesResult {
  const source: GenerationSource = input.source ?? "url";
  const overwrite = input.overwrite ?? false;

  const written: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(input.versionDir)) {
    throw new Error(`Version directory not found: ${input.versionDir}`);
  }

  const agentsPath = path.join(input.versionDir, "AGENTS.md");
  if (fs.existsSync(agentsPath) && !overwrite) {
    skipped.push("AGENTS.md");
  } else {
    const content = renderAgentsMd({
      projectName: input.projectName,
      source,
      enabledPlugins: input.enabledPlugins,
    });
    fs.writeFileSync(agentsPath, content, "utf-8");
    written.push("AGENTS.md");
  }

  return { written, skipped };
}
