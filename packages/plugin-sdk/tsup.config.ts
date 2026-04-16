import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/pluginCli.ts",
    "src/pluginContracts.ts",
    "src/pluginPackages.ts",
    "src/plugins.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
