import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cms/index.ts",
    "src/studio/index.ts",
    "src/config/index.ts",
    "src/types/index.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
