import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/db/migrate.ts"],
  format: ["esm"],
  clean: true,
  shims: true,
  noExternal: [
    /^@vivd\/plugin-analytics(\/.*)?$/,
    /^@vivd\/plugin-contact-form(\/.*)?$/,
  ],
  // Mark extract-zip as external to avoid bundling issues with debug's dynamic require of 'tty'
  external: ["extract-zip"],
});
