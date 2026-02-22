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
): string {
  const comment =
    format === "astro"
      ? "{/* Contact form (Vivd contact_form plugin) */}"
      : "<!-- Contact form (Vivd contact_form plugin) -->";

  const renderedFields = formFields.map((field) => renderFormField(field)).join("\n\n");

  return `${comment}
<form method="POST" action="${submitEndpoint}">
  <input type="hidden" name="token" value="${token}" />
  <input type="text" name="_honeypot" style="display:none" tabindex="-1" autocomplete="off" />

${renderedFields}

  <button type="submit">Send</button>
</form>`;
}

export function getContactFormSnippets(
  token: string,
  submitEndpoint: string,
  options?: {
    formFields?: ContactFormFieldConfig[];
  },
): ContactFormSnippetSet {
  const formFields = options?.formFields?.length
    ? options.formFields
    : DEFAULT_CONTACT_FORM_FIELDS;

  return {
    html: formatSnippet(token, submitEndpoint, "html", formFields),
    astro: formatSnippet(token, submitEndpoint, "astro", formFields),
  };
}
