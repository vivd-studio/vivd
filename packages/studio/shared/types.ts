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
  name: z.string(),
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
  sourceLoc: z.string().optional(),
  oldValue: z.string(),
  newValue: z.string(),
});

export const setAstroImagePatchSchema = z.object({
  type: z.literal("setAstroImage"),
  sourceFile: z.string(),
  sourceLoc: z.string().optional(),
  assetPath: z.string(),
  oldValue: z.string().optional(),
});

export const htmlPatchSchema = z.discriminatedUnion("type", [
  setTextNodePatchSchema,
  setAttrPatchSchema,
  setI18nPatchSchema,
]);

export const vivdPatchSchema = z.discriminatedUnion("type", [
  setTextNodePatchSchema,
  setAttrPatchSchema,
  setI18nPatchSchema,
  setAstroTextPatchSchema,
  setAstroImagePatchSchema,
]);

export type SetTextNodePatch = z.infer<typeof setTextNodePatchSchema>;
export type SetAttrPatch = z.infer<typeof setAttrPatchSchema>;
export type SetI18nPatch = z.infer<typeof setI18nPatchSchema>;
export type SetAstroTextPatch = z.infer<typeof setAstroTextPatchSchema>;
export type SetAstroImagePatch = z.infer<typeof setAstroImagePatchSchema>;
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
  sourceLoc?: string;
  oldValue: string;
  newValue: string;
}

export interface AstroImagePatch {
  sourceFile: string;
  sourceLoc?: string;
  assetPath: string;
  oldValue?: string;
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
