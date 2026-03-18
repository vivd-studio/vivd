export function astroExpressiveCode() {
  return {
    name: "vivd-astro-expressive-code-shim",
    hooks: {},
  };
}

export class ExpressiveCodeTheme {
  constructor(input = {}) {
    this.name = input.name ?? "vivd-shim-theme";
    this.type = input.type ?? "dark";
    this.colors = { ...(input.colors ?? {}) };
    this.settings = Array.isArray(input.settings)
      ? input.settings.map((entry) => ({
          ...entry,
          settings: { ...(entry?.settings ?? {}) },
        }))
      : [];
    this.styleOverrides = { ...(input.styleOverrides ?? {}) };
    this.bg = input.bg ?? null;
  }

  static fromJSONString(source) {
    try {
      return new ExpressiveCodeTheme(JSON.parse(source));
    } catch {
      return new ExpressiveCodeTheme();
    }
  }
}

export const pluginFramesTexts = {
  overrideTexts() {},
};
