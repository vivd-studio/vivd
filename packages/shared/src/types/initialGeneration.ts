export const INITIAL_GENERATION_MANIFEST_VERSION = 1;
export const INITIAL_GENERATION_MANIFEST_RELATIVE_PATH =
  ".vivd/initial-generation.json";
export const SCRATCH_REFERENCE_FILES_RELATIVE_PATH = "references";
export const SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH = "images";
export const SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH =
  "src/content/media/shared";

export type ScratchCreationMode = "legacy_html" | "studio_astro";

export function getScratchBrandAssetsRelativePath(
  mode: ScratchCreationMode,
): string {
  return mode === "studio_astro"
    ? SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH
    : SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH;
}

export type InitialGenerationFlow = "scratch";

export type InitialGenerationState =
  | "draft"
  | "starting_studio"
  | "generating_initial_site"
  | "initial_generation_paused"
  | "completed"
  | "failed";

export interface ScratchInitialGenerationManifest {
  version: typeof INITIAL_GENERATION_MANIFEST_VERSION;
  flow: "scratch";
  mode: "studio_astro";
  state: InitialGenerationState;
  title: string;
  description: string;
  businessType?: string;
  stylePreset?: string;
  stylePalette?: string[];
  styleMode?: "exact" | "reference";
  siteTheme?: "dark" | "light";
  referenceUrls?: string[];
  sessionId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
}
