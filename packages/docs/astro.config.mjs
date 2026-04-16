import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const showOperatorGuides =
  process.env.PUBLIC_VIVD_DOCS_SHOW_OPERATOR_GUIDES === "true";

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
        {
          label: "Start Here",
          items: [
            { slug: "index", label: "Overview" },
            { slug: "features" },
            { slug: "how-vivd-works", label: "How Vivd Works" },
            { slug: "getting-started" },
            { slug: "faq-glossary" },
          ],
        },
        {
          label: "Build & Launch",
          items: [
            { slug: "import-existing-website" },
            { slug: "create-from-scratch" },
            { slug: "edit-in-studio" },
            { slug: "publish-your-site" },
            { slug: "domains-and-publish-targets", label: "Domains & Publish Targets" },
          ],
        },
        {
          label: "Plugins",
          items: [
            { slug: "plugins", label: "Overview" },
            { slug: "plugins/contact-form" },
            { slug: "plugins/analytics" },
          ],
        },
        {
          label: "Access & Support",
          items: [
            { slug: "teams-and-access", label: "Organization User Management" },
            { slug: "troubleshooting" },
          ],
        },
        ...(showOperatorGuides
          ? [
              {
                label: "Operator Guides (Experimental)",
                items: [
                  { slug: "self-hosting", label: "Self-Hosting" },
                  {
                    slug: "self-host-config-reference",
                    label: "Self-Host Config Reference",
                  },
                  { slug: "instance-settings", label: "Instance Settings" },
                  { slug: "email-and-deliverability", label: "Email & Deliverability" },
                ],
              },
            ]
          : []),
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
