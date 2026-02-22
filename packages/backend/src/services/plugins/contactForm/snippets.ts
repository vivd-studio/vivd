export type ContactFormSnippetFormat = "html" | "astro";

export interface ContactFormSnippetSet {
  html: string;
  astro: string;
}

function formatSnippet(
  token: string,
  submitEndpoint: string,
  format: ContactFormSnippetFormat,
): string {
  const comment =
    format === "astro"
      ? "{/* Contact form (Vivd contact_form plugin) */}"
      : "<!-- Contact form (Vivd contact_form plugin) -->";

  return `${comment}
<form method="POST" action="${submitEndpoint}">
  <input type="hidden" name="token" value="${token}" />
  <input type="text" name="_honeypot" style="display:none" tabindex="-1" autocomplete="off" />

  <label>
    Name
    <input type="text" name="name" required />
  </label>

  <label>
    Email
    <input type="email" name="email" required />
  </label>

  <label>
    Message
    <textarea name="message" rows="5" required></textarea>
  </label>

  <button type="submit">Send</button>
</form>`;
}

export function getContactFormSnippets(
  token: string,
  submitEndpoint: string,
): ContactFormSnippetSet {
  return {
    html: formatSnippet(token, submitEndpoint, "html"),
    astro: formatSnippet(token, submitEndpoint, "astro"),
  };
}
