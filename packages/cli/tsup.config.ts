import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: [
    /^@vivd\/plugin-analytics(\/.*)?$/,
    /^@vivd\/plugin-contact-form(\/.*)?$/,
  ],
});
