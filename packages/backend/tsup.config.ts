import { defineConfig } from "tsup";
import { createInstalledPluginPackageMatchers } from "../../plugins/installed/registry.helpers.mjs";

export default defineConfig({
  entry: ["src/server.ts", "src/db/migrate.ts"],
  format: ["esm"],
  clean: true,
  shims: true,
  noExternal: [
    /^@vivd\/installed-plugins(\/.*)?$/,
    ...createInstalledPluginPackageMatchers(),
  ],
  // Keep CommonJS-only deps external so Node can load them natively from the ESM bundle.
  external: ["extract-zip", "maxmind"],
});
