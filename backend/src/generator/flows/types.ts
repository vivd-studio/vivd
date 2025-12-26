export type GenerationSource = "url" | "scratch";

export interface GenerationContext {
  source: GenerationSource;
  slug: string;
  version: number;
  outputDir: string;
  updateStatus: (status: string) => void;
}

