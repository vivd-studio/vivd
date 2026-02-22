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

function buildSubmitScript(isAstro: boolean): string {
  const scriptTag = isAstro ? "<script is:inline>" : "<script>";
  // Compact inline script – submits via fetch, shows inline feedback.
  return `${scriptTag}
(function(){
  var w=document.currentScript.previousElementSibling;
  var f=w.querySelector("form");
  var s=w.querySelector("[data-vivd-status]");
  var b=f.querySelector('[type="submit"]');
  var bl=b.textContent;
  f.addEventListener("submit",function(e){
    e.preventDefault();
    b.disabled=true;b.textContent="Sending\\u2026";
    s.style.display="none";
    var fd=new FormData(f),body={};
    fd.forEach(function(v,k){body[k]=v});
    fetch(f.action,{
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(body)
    })
    .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,data:j}})})
    .then(function(r){
      if(r.ok&&r.data.ok){
        f.style.display="none";
        s.textContent="Thank you! Your message has been sent.";
        s.style.display="";
      }else{
        throw new Error(r.data.error&&r.data.error.message||"");
      }
    })
    .catch(function(err){
      s.textContent=err.message||"Something went wrong. Please try again.";
      s.style.display="";
      b.disabled=false;b.textContent=bl;
      if(typeof turnstile!=="undefined")try{turnstile.reset(w.querySelector(".cf-turnstile"))}catch(e){}
    });
  });
})();
</script>`;
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

  const submitScript = buildSubmitScript(format === "astro");

  return `${comment}
${turnstileScript}<div data-vivd-contact-form>
<form method="POST" action="${submitEndpoint}">
  <input type="hidden" name="token" value="${token}" />
  <input type="text" name="_honeypot" style="display:none" tabindex="-1" autocomplete="off" />

${renderedFields}
${turnstileWidget}
  <button type="submit">Send</button>
</form>
<div data-vivd-status style="display:none"></div>
</div>
${submitScript}`;
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
