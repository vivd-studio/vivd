import { normalizeGhcrRepository, resolveLatestSemverImageFromGhcr } from "./ghcr";
import {
  getSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "../../system/SystemSettingsService";

const STUDIO_IMAGE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

type ImageCache = { image: string; fetchedAt: number };
type GetDesiredImageOptions = { forceRefresh?: boolean };

export class FlyStudioImageResolver {
  private resolvedImageCache: ImageCache | null = null;
  private resolveImageInflight: Promise<string> | null = null;
  private readonly options: {
    getStudioImageRepository: () => string;
  };

  constructor(options: { getStudioImageRepository: () => string }) {
    this.options = options;
  }

  private get fallbackStudioImage(): string {
    try {
      const { imageBase } = normalizeGhcrRepository(
        this.options.getStudioImageRepository(),
      );
      return `${imageBase}:latest`;
    } catch {
      return "ghcr.io/vivd-studio/vivd-studio:latest";
    }
  }

  private async resolveLatestStudioImageFromGhcr(): Promise<string> {
    return resolveLatestSemverImageFromGhcr({
      repository: this.options.getStudioImageRepository(),
      timeoutMs: 10_000,
    });
  }

  invalidateDesiredImageCache(): void {
    this.resolvedImageCache = null;
  }

  async getDesiredImage(options: GetDesiredImageOptions = {}): Promise<string> {
    const forceRefresh = options.forceRefresh === true;
    const configured = process.env.FLY_STUDIO_IMAGE?.trim();
    if (configured) return configured;

    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl) {
      try {
        const storedTagRaw = await getSystemSettingValue(
          SYSTEM_SETTING_KEYS.studioMachineImageTagOverride,
        );
        const storedTag = storedTagRaw?.trim() || "";
        if (storedTag && STUDIO_IMAGE_TAG_PATTERN.test(storedTag)) {
          let imageBase = "ghcr.io/vivd-studio/vivd-studio";
          try {
            imageBase = normalizeGhcrRepository(
              this.options.getStudioImageRepository(),
            ).imageBase;
          } catch {
            // Ignore invalid repo; keep hardcoded fallback base.
          }
          return `${imageBase}:${storedTag}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[FlyMachines] Failed to load studio image override tag: ${message}`,
        );
      }
    }

    const now = Date.now();
    const refreshMs = 300_000; // 5 minutes
    if (
      !forceRefresh &&
      this.resolvedImageCache &&
      now - this.resolvedImageCache.fetchedAt < refreshMs
    ) {
      return this.resolvedImageCache.image;
    }

    const inflight = this.resolveImageInflight;
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const resolved = await this.resolveLatestStudioImageFromGhcr();
        this.resolvedImageCache = { image: resolved, fetchedAt: Date.now() };
        return resolved;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[FlyMachines] Failed to resolve latest studio image: ${message}`);
        return this.resolvedImageCache?.image || this.fallbackStudioImage;
      } finally {
        this.resolveImageInflight = null;
      }
    })();

    this.resolveImageInflight = promise;
    return promise;
  }
}
