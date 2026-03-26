import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: true,
  splitting: false,
  treeshake: true,
});
