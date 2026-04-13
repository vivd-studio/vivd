import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "server/index.ts",
    "opencode/snapshotGitDirRepair":
      "server/opencode/snapshotGitDirRepair.ts",
    "opencode/snapshotGitDirRepairCli":
      "server/opencode/snapshotGitDirRepairCli.ts",
    "opencode/toolModules/vivdImageAi":
      "server/opencode/toolModules/vivdImageAi.ts",
  },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  clean: true,
  splitting: true,
  noExternal: [
    /^@vivd\/installed-plugins(\/.*)?$/,
    /^@vivd\/plugin-analytics(\/.*)?$/,
    /^@vivd\/plugin-contact-form(\/.*)?$/,
    /^@vivd\/plugin-newsletter(\/.*)?$/,
  ],
});
