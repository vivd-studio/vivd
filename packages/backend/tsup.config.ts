import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/db/migrate.ts"],
  format: ["esm"],
  clean: true,
  shims: true,
  noExternal: [
    /^@vivd\/installed-plugins(\/.*)?$/,
    /^@vivd\/plugin-analytics(\/.*)?$/,
    /^@vivd\/plugin-contact-form(\/.*)?$/,
    /^@vivd\/plugin-newsletter(\/.*)?$/,
  ],
  // Keep CommonJS-only deps external so Node can load them natively from the ESM bundle.
  external: ["extract-zip", "maxmind"],
});
