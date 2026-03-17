import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: process.env.VIVD_DOCS_SITE_URL || "http://docs.localhost",
  output: "static",
  server: {
    host: "0.0.0.0",
    port: 4321,
  },
  integrations: [
    starlight({
      title: "Vivd Docs",
      description:
        "Public product documentation for creating, editing, publishing, and operating websites in Vivd.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/vivd-studio/vivd",
        },
      ],
    }),
  ],
});
