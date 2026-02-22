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

  it("renders configured custom form fields", () => {
    const token = "ppi_test.token123";
    const submitEndpoint = "https://api.vivd.studio/plugins/contact/v1/submit";
    const snippets = getContactFormSnippets(token, submitEndpoint, {
      formFields: [
        {
          key: "full_name",
          label: "Full name",
          type: "text",
          required: true,
          placeholder: "Jane Doe",
        },
        {
          key: "details",
          label: "Project details",
          type: "textarea",
          required: false,
          placeholder: "Tell us about your project",
          rows: 6,
        },
      ],
    });

    expect(snippets.html).toContain('name="full_name"');
    expect(snippets.html).toContain("Full name");
    expect(snippets.html).toContain('placeholder="Jane Doe"');
    expect(snippets.html).toContain('name="details"');
    expect(snippets.html).toContain('rows="6"');
  });
});
