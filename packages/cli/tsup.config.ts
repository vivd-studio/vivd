import { defineConfig } from "tsup";
import { createInstalledPluginPackageMatchers } from "../../plugins/installed/registry.helpers.mjs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: [
    /^@vivd\/installed-plugins(\/.*)?$/,
    ...createInstalledPluginPackageMatchers(),
  ],
});
