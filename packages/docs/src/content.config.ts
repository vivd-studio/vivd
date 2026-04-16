import { defineCollection } from "astro:content";
import { glob, type Loader, type LoaderContext } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

const docsExtensions = ["markdown", "mdown", "mkdn", "mkd", "mdwn", "md", "mdx"];

function generatedDocsLoader(): Loader {
  return {
    name: "starlight-docs-loader",
    load: (context: LoaderContext) =>
      glob({
        base: "./generated/src/content/docs",
        pattern: `**/[^_]*.{${docsExtensions.join(",")}}`,
      }).load(context),
  };
}

export const collections = {
  docs: defineCollection({
    loader: generatedDocsLoader(),
    schema: docsSchema(),
  }),
};
