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
export const TEMPLATE_FILES = [".gitignore"] as const;
export type TemplateFileName = (typeof TEMPLATE_FILES)[number];

// Load template content from template files
function loadTemplate(filename: string): string {
  const templatePath = path.join(TEMPLATES_DIR, filename);
  return fs.readFileSync(templatePath, "utf-8");
}

// Lazy-load templates to avoid issues during module initialization
let GITIGNORE_TEMPLATE: string | null = null;

function getGitignoreTemplate(): string {
  if (GITIGNORE_TEMPLATE === null) {
    GITIGNORE_TEMPLATE = loadTemplate("gitignore.txt");
  }
  return GITIGNORE_TEMPLATE;
}

export function renderProjectTemplateFiles(
  input: RenderProjectTemplateFilesInput
): Record<TemplateFileName, string> {
  void input;
  return {
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
