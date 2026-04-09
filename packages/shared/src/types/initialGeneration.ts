export const INITIAL_GENERATION_MANIFEST_VERSION = 1;
export const INITIAL_GENERATION_MANIFEST_RELATIVE_PATH =
  ".vivd/initial-generation.json";

export type ScratchCreationMode = "legacy_html" | "studio_astro";

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
