import {
  DEFAULT_CONTACT_FORM_FIELDS,
  type ContactFormFieldConfig,
} from "./config";

export type ContactFormSnippetFormat = "html" | "astro";

export interface ContactFormSnippetSet {
  html: string;
  astro: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFormField(field: ContactFormFieldConfig): string {
  const requiredAttr = field.required ? " required" : "";
  const placeholderAttr = field.placeholder
    ? ` placeholder="${escapeHtml(field.placeholder)}"`
    : "";
  const fieldName = escapeHtml(field.key);
  const fieldLabel = escapeHtml(field.label);

  if (field.type === "textarea") {
    const rows = field.rows ?? 5;
    return `  <label>
    ${fieldLabel}
    <textarea name="${fieldName}" rows="${rows}"${requiredAttr}${placeholderAttr}></textarea>
  </label>`;
  }

  const inputType = field.type === "email" ? "email" : "text";
  return `  <label>
    ${fieldLabel}
    <input type="${inputType}" name="${fieldName}"${requiredAttr}${placeholderAttr} />
  </label>`;
}

function formatSnippet(
  token: string,
  submitEndpoint: string,
  format: ContactFormSnippetFormat,
  formFields: ContactFormFieldConfig[],
  turnstileSiteKey: string | null,
): string {
  const comment =
    format === "astro"
      ? "{/* Contact form (Vivd contact_form plugin) */}"
      : "<!-- Contact form (Vivd contact_form plugin) -->";

  const renderedFields = formFields.map((field) => renderFormField(field)).join("\n\n");
  const resolvedTurnstileSiteKey = (turnstileSiteKey || "").trim();
  const turnstileScript = resolvedTurnstileSiteKey
    ? `<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\" async defer></script>\n`
    : "";
  const turnstileWidget = resolvedTurnstileSiteKey
    ? `\n  <div class=\"cf-turnstile\" data-sitekey=\"${escapeHtml(
        resolvedTurnstileSiteKey,
      )}\"></div>\n`
    : "\n";

  return `${comment}
${turnstileScript}<form method="POST" action="${submitEndpoint}">
  <input type="hidden" name="token" value="${token}" />
  <input type="text" name="_honeypot" style="display:none" tabindex="-1" autocomplete="off" />

${renderedFields}
${turnstileWidget}
  <button type="submit">Send</button>
</form>`;
}

export function getContactFormSnippets(
  token: string,
  submitEndpoint: string,
  options?: {
    formFields?: ContactFormFieldConfig[];
    turnstileSiteKey?: string | null;
  },
): ContactFormSnippetSet {
  const formFields = options?.formFields?.length
    ? options.formFields
    : DEFAULT_CONTACT_FORM_FIELDS;
  const turnstileSiteKey = options?.turnstileSiteKey || null;

  return {
    html: formatSnippet(token, submitEndpoint, "html", formFields, turnstileSiteKey),
    astro: formatSnippet(token, submitEndpoint, "astro", formFields, turnstileSiteKey),
  };
}
