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
      favicon: "/docs-brand-mark.svg",
      customCss: ["./src/styles/custom.css"],
      expressiveCode: false,
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      sidebar: [
        { slug: "index", label: "Overview" },
        { slug: "getting-started" },
        { slug: "self-hosting", label: "Self-Hosting" },
        { slug: "import-existing-website" },
        { slug: "create-from-scratch" },
        { slug: "edit-in-studio" },
        { slug: "publish-your-site" },
        {
          label: "Plugins",
          items: [
            { slug: "plugins", label: "Overview" },
            { slug: "plugins/contact-form" },
            { slug: "plugins/analytics" },
          ],
        },
        { slug: "teams-and-access" },
        { slug: "troubleshooting" },
        { slug: "faq-glossary" },
      ],
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
