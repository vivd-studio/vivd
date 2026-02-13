import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerationSource } from "./flows/types";

// Get the directory of this module for resolving template paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "templates");

export interface ApplyProjectTemplateFilesInput {
  versionDir: string;
  source?: GenerationSource;
  projectName: string;
  enabledPlugins?: string[];
  overwrite?: boolean;
}

export interface RenderProjectTemplateFilesInput {
  source?: GenerationSource;
  projectName: string;
  enabledPlugins?: string[];
}

export interface ApplyProjectTemplateFilesResult {
  written: string[];
  skipped: string[];
}

// Template file names (for tracking and migration)
export const TEMPLATE_FILES = ["AGENTS.md", ".gitignore"] as const;
export type TemplateFileName = (typeof TEMPLATE_FILES)[number];

function formatPlugins(enabledPlugins?: string[]): string {
  if (!enabledPlugins?.length) return "None";
  return enabledPlugins.map((p) => `- ${p}`).join("\n");
}

// Load template content from template files
function loadTemplate(filename: string): string {
  const templatePath = path.join(TEMPLATES_DIR, filename);
  return fs.readFileSync(templatePath, "utf-8");
}

// Lazy-load templates to avoid issues during module initialization
let AGENTS_MD_URL_TEMPLATE: string | null = null;
let AGENTS_MD_SCRATCH_TEMPLATE: string | null = null;
let GITIGNORE_TEMPLATE: string | null = null;

function getAgentsUrlTemplate(): string {
  if (AGENTS_MD_URL_TEMPLATE === null) {
    AGENTS_MD_URL_TEMPLATE = loadTemplate("agents-url.md");
  }
  return AGENTS_MD_URL_TEMPLATE;
}

function getAgentsScratchTemplate(): string {
  if (AGENTS_MD_SCRATCH_TEMPLATE === null) {
    AGENTS_MD_SCRATCH_TEMPLATE = loadTemplate("agents-scratch.md");
  }
  return AGENTS_MD_SCRATCH_TEMPLATE;
}

function getGitignoreTemplate(): string {
  if (GITIGNORE_TEMPLATE === null) {
    GITIGNORE_TEMPLATE = loadTemplate("gitignore.txt");
  }
  return GITIGNORE_TEMPLATE;
}

function renderAgentsMd(input: {
  projectName: string;
  source: GenerationSource;
  enabledPlugins?: string[];
}): string {
  const template =
    input.source === "scratch"
      ? getAgentsScratchTemplate()
      : getAgentsUrlTemplate();

  return template
    .replace(/{project_name}/g, input.projectName)
    .replace(/{enabled_plugins}/g, formatPlugins(input.enabledPlugins));
}

export function renderProjectTemplateFiles(
  input: RenderProjectTemplateFilesInput
): Record<TemplateFileName, string> {
  const source: GenerationSource = input.source ?? "url";
  return {
    "AGENTS.md": renderAgentsMd({
      projectName: input.projectName,
      source,
      enabledPlugins: input.enabledPlugins,
    }),
    ".gitignore": getGitignoreTemplate(),
  };
}

export function applyProjectTemplateFiles(
  input: ApplyProjectTemplateFilesInput
): ApplyProjectTemplateFilesResult {
  const overwrite = input.overwrite ?? false;
  const templates = renderProjectTemplateFiles({
    source: input.source,
    projectName: input.projectName,
    enabledPlugins: input.enabledPlugins,
  });

  const written: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(input.versionDir)) {
    throw new Error(`Version directory not found: ${input.versionDir}`);
  }

  // Write AGENTS.md
  const agentsPath = path.join(input.versionDir, "AGENTS.md");
  if (fs.existsSync(agentsPath) && !overwrite) {
    skipped.push("AGENTS.md");
  } else {
    fs.writeFileSync(agentsPath, templates["AGENTS.md"], "utf-8");
    written.push("AGENTS.md");
  }

  // Write .gitignore
  const gitignorePath = path.join(input.versionDir, ".gitignore");
  if (fs.existsSync(gitignorePath) && !overwrite) {
    skipped.push(".gitignore");
  } else {
    fs.writeFileSync(gitignorePath, templates[".gitignore"], "utf-8");
    written.push(".gitignore");
  }

  return { written, skipped };
}
