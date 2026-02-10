export type GenerationSource = "url" | "scratch";

export interface GenerationContext {
  organizationId: string;
  source: GenerationSource;
  slug: string;
  version: number;
  outputDir: string;
  /**
   * Update the status of the generation.
   * @param status - The new status (e.g., "scraping", "failed", "completed")
   * @param errorMessage - Optional error message to store when status is "failed"
   */
  updateStatus: (status: string, errorMessage?: string) => void;
}
