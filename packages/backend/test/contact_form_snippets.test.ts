import { describe, expect, it } from "vitest";
import { getContactFormSnippets } from "../src/services/plugins/contactForm/snippets";

describe("contact form snippets", () => {
  it("renders both html and astro snippets with the token", () => {
    const token = "ppi_test.token123";
    const submitEndpoint = "https://api.vivd.studio/plugins/contact/v1/submit";
    const snippets = getContactFormSnippets(token, submitEndpoint);

    expect(snippets.html).toContain(token);
    expect(snippets.astro).toContain(token);
    expect(snippets.html).toContain(submitEndpoint);
    expect(snippets.astro).toContain(submitEndpoint);
  });
});
