import type { NewsletterPluginConfig } from "./config";

export interface NewsletterSnippetSet {
  html: string;
  astro: string;
}

function buildBodyFields(config: NewsletterPluginConfig): string {
  const nameField = config.collectName
    ? `  <label>\n    <span>Name</span>\n    <input type="text" name="name" autocomplete="name" />\n  </label>\n`
    : "";

  return (
    `${nameField}` +
    `  <label>\n    <span>Email</span>\n    <input type="email" name="email" required autocomplete="email" />\n  </label>\n`
  );
}

export function getNewsletterSnippets(
  token: string,
  subscribeEndpoint: string,
  config: NewsletterPluginConfig,
): NewsletterSnippetSet {
  const bodyFields = buildBodyFields(config);
  const heading =
    config.mode === "waitlist" ? "Join the waitlist" : "Subscribe";
  const buttonLabel =
    config.mode === "waitlist" ? "Join waitlist" : "Subscribe";

  const html =
    `<!-- Vivd newsletter plugin -->\n` +
    `<form action="${subscribeEndpoint}" method="POST">\n` +
    `  <input type="hidden" name="token" value="${token}" />\n` +
    `  <div style="position:absolute;left:-9999px;opacity:0;pointer-events:none;" aria-hidden="true">\n` +
    `    <label>Leave this empty <input type="text" name="_honeypot" tabindex="-1" autocomplete="off" /></label>\n` +
    `  </div>\n` +
    `  <h3>${heading}</h3>\n` +
    bodyFields +
    `  <button type="submit">${buttonLabel}</button>\n` +
    `</form>`;

  const astro =
    `{/* Vivd newsletter plugin */}\n` +
    `<form action="${subscribeEndpoint}" method="POST">\n` +
    `  <input type="hidden" name="token" value="${token}" />\n` +
    `  <div style="position:absolute;left:-9999px;opacity:0;pointer-events:none;" aria-hidden="true">\n` +
    `    <label>Leave this empty <input type="text" name="_honeypot" tabindex="-1" autocomplete="off" /></label>\n` +
    `  </div>\n` +
    `  <h3>${heading}</h3>\n` +
    bodyFields +
    `  <button type="submit">${buttonLabel}</button>\n` +
    `</form>`;

  return { html, astro };
}
