import { z } from "zod";

// Patch types
export const setTextNodePatchSchema = z.object({
  type: z.literal("setTextNode"),
  selector: z.string(),
  index: z.number(),
  value: z.string(),
});

export const setAttrPatchSchema = z.object({
  type: z.literal("setAttr"),
  selector: z.string(),
  attr: z.string(),
  value: z.string(),
});

export const setI18nPatchSchema = z.object({
  type: z.literal("setI18n"),
  key: z.string(),
  lang: z.string(),
  value: z.string(),
});

export const setAstroTextPatchSchema = z.object({
  type: z.literal("setAstroText"),
  sourceFile: z.string(),
  sourceLoc: z
    .object({
      startLine: z.number(),
      startCol: z.number(),
      endLine: z.number(),
      endCol: z.number(),
    })
    .optional(),
  oldValue: z.string(),
  newValue: z.string(),
});

export const htmlPatchSchema = z.discriminatedUnion("type", [
  setTextNodePatchSchema,
  setAttrPatchSchema,
  setI18nPatchSchema,
]);

export const vivdPatchSchema = z.discriminatedUnion("type", [
  setTextNodePatchSchema,
  setI18nPatchSchema,
  setAstroTextPatchSchema,
]);

export type SetTextNodePatch = z.infer<typeof setTextNodePatchSchema>;
export type SetAttrPatch = z.infer<typeof setAttrPatchSchema>;
export type SetI18nPatch = z.infer<typeof setI18nPatchSchema>;
export type SetAstroTextPatch = z.infer<typeof setAstroTextPatchSchema>;
export type HtmlPatch = z.infer<typeof htmlPatchSchema>;
export type VivdPatch = z.infer<typeof vivdPatchSchema>;

// I18n patch type
export interface I18nJsonPatch {
  key: string;
  lang: string;
  value: string;
}

// Astro patch type
export interface AstroTextPatch {
  sourceFile: string;
  sourceLoc?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  oldValue: string;
  newValue: string;
}

// Preview info
export interface PreviewInfo {
  url: string;
  mode: "static" | "dev-server";
  projectType: string;
}

// Git status
export interface GitStatus {
  hasChanges: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

// Apply patches result
export interface ApplyPatchesResult {
  success: boolean;
  modifiedFiles: string[];
  errors: string[];
}

// Studio configuration passed on startup
export interface StudioConfig {
  repoUrl: string;
  gitToken?: string;
  branch?: string;
  port?: number;
}
