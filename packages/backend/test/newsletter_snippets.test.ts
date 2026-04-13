import { describe, expect, it } from "vitest";
import { getNewsletterSnippets } from "@vivd/plugin-newsletter/backend/snippets";

describe("newsletter snippets", () => {
  it("renders inline submit handling and visible feedback", () => {
    const token = "ppi_test.token123";
    const subscribeEndpoint =
      "https://api.vivd.studio/plugins/newsletter/v1/subscribe";

    const snippets = getNewsletterSnippets(token, subscribeEndpoint, {
      mode: "waitlist",
      collectName: false,
      sourceHosts: [],
      redirectHostAllowlist: [],
    });

    expect(snippets.html).toContain(token);
    expect(snippets.html).toContain(subscribeEndpoint);
    expect(snippets.html).toContain('data-vivd-newsletter-form');
    expect(snippets.html).toContain('data-vivd-status');
    expect(snippets.html).toContain('fetch(f.action');
    expect(snippets.html).toContain(
      "Please check your email to confirm your waitlist signup.",
    );
    expect(snippets.html).toContain("Join waitlist");
  });

  it("renders astro snippets with inline script and optional name field", () => {
    const token = "ppi_test.token123";
    const subscribeEndpoint =
      "https://api.vivd.studio/plugins/newsletter/v1/subscribe";

    const snippets = getNewsletterSnippets(token, subscribeEndpoint, {
      mode: "newsletter",
      collectName: true,
      sourceHosts: [],
      redirectHostAllowlist: [],
    });

    expect(snippets.astro).toContain("<script is:inline>");
    expect(snippets.astro).toContain('name="name"');
    expect(snippets.astro).toContain("Subscribe");
  });
});
