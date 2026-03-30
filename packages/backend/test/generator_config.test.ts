import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadGeneratorConfig() {
  return await import("../src/generator/config");
}

describe("generator config", () => {
  const envSnapshot = {
    VIVD_GENERATION_MODEL: process.env.VIVD_GENERATION_MODEL,
    VIVD_ANALYSIS_MODEL: process.env.VIVD_ANALYSIS_MODEL,
    VIVD_HERO_GENERATION_MODEL: process.env.VIVD_HERO_GENERATION_MODEL,
    VIVD_IMAGE_EDITING_MODEL: process.env.VIVD_IMAGE_EDITING_MODEL,
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.VIVD_GENERATION_MODEL;
    delete process.env.VIVD_ANALYSIS_MODEL;
    delete process.env.VIVD_HERO_GENERATION_MODEL;
    delete process.env.VIVD_IMAGE_EDITING_MODEL;
  });

  afterEach(() => {
    vi.resetModules();
    restoreEnv("VIVD_GENERATION_MODEL", envSnapshot.VIVD_GENERATION_MODEL);
    restoreEnv("VIVD_ANALYSIS_MODEL", envSnapshot.VIVD_ANALYSIS_MODEL);
    restoreEnv("VIVD_HERO_GENERATION_MODEL", envSnapshot.VIVD_HERO_GENERATION_MODEL);
    restoreEnv("VIVD_IMAGE_EDITING_MODEL", envSnapshot.VIVD_IMAGE_EDITING_MODEL);
  });

  it("defaults scratch generation to gemini 3.1 pro preview", async () => {
    const config = await loadGeneratorConfig();

    expect(config.GENERATION_MODEL).toBe("google/gemini-3.1-pro-preview");
    expect(config.ANALYSIS_MODEL).toBe("google/gemini-3.1-pro-preview");
  });

  it("lets env overrides replace the default scratch models", async () => {
    process.env.VIVD_GENERATION_MODEL = "custom/generation-model";
    process.env.VIVD_ANALYSIS_MODEL = "custom/analysis-model";
    process.env.VIVD_HERO_GENERATION_MODEL = "custom/hero-model";
    process.env.VIVD_IMAGE_EDITING_MODEL = "custom/edit-model";

    const config = await loadGeneratorConfig();

    expect(config.GENERATION_MODEL).toBe("custom/generation-model");
    expect(config.ANALYSIS_MODEL).toBe("custom/analysis-model");
    expect(config.HERO_GENERATION_MODEL).toBe("custom/hero-model");
    expect(config.IMAGE_EDITING_MODEL).toBe("custom/edit-model");
  });

  it("reuses the generation and hero defaults when only partial overrides are set", async () => {
    process.env.VIVD_GENERATION_MODEL = "custom/generation-model";
    process.env.VIVD_HERO_GENERATION_MODEL = "custom/hero-model";

    const config = await loadGeneratorConfig();

    expect(config.ANALYSIS_MODEL).toBe("custom/generation-model");
    expect(config.IMAGE_EDITING_MODEL).toBe("custom/hero-model");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
