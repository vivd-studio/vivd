import type { NewsletterPluginConfig } from "./config";

type NewsletterSnippetFormat = "html" | "astro";

export interface NewsletterSnippetSet {
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

function buildBodyFields(config: NewsletterPluginConfig): string {
  const nameField = config.collectName
    ? `  <label>\n    <span>Name</span>\n    <input type="text" name="name" autocomplete="name" />\n  </label>\n`
    : "";

  return (
    `${nameField}` +
    `  <label>\n    <span>Email</span>\n    <input type="email" name="email" required autocomplete="email" />\n  </label>\n`
  );
}

function buildSubmitScript(options: {
  format: NewsletterSnippetFormat;
  defaultButtonLabel: string;
  successMessage: string;
}): string {
  const scriptTag = options.format === "astro" ? "<script is:inline>" : "<script>";

  return `${scriptTag}
(function(){
  function bind(w){
    if(!w||w.getAttribute("data-vivd-newsletter-bound")==="1")return;
    var f=w.querySelector("form");
    var s=w.querySelector("[data-vivd-status]");
    if(!f||!s)return;
    var b=f.querySelector('[type="submit"]');
    if(!b)return;
    w.setAttribute("data-vivd-newsletter-bound","1");
    var bl=b.textContent||"${escapeHtml(options.defaultButtonLabel)}";
    f.addEventListener("submit",function(e){
      e.preventDefault();
      b.disabled=true;
      b.textContent="Sending\\u2026";
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
        if(r.ok&&r.data&&r.data.ok&&r.data.result){
          var status=r.data.result.status;
          if(status==="already_confirmed"){
            s.textContent="This email address is already confirmed.";
          }else if(status==="pending_cooldown"){
            s.textContent="A confirmation email was sent recently. Please check your inbox and spam folder.";
          }else{
            s.textContent="${escapeHtml(options.successMessage)}";
          }
          f.style.display="none";
          s.style.display="";
          return;
        }
        throw new Error(r.data&&r.data.error&&r.data.error.message||"");
      })
      .catch(function(err){
        s.textContent=err.message||"Something went wrong. Please try again.";
        s.style.display="";
        b.disabled=false;
        b.textContent=bl;
      });
    });
  }
  var script=document.currentScript;
  var sibling=script&&script.previousElementSibling;
  if(sibling&&sibling.matches&&sibling.matches("[data-vivd-newsletter-form]")){
    bind(sibling);
    return;
  }
  var forms=document.querySelectorAll("[data-vivd-newsletter-form]");
  for(var i=0;i<forms.length;i++)bind(forms[i]);
})();
</script>`;
}

function formatSnippet(
  token: string,
  subscribeEndpoint: string,
  config: NewsletterPluginConfig,
  format: NewsletterSnippetFormat,
): string {
  const comment =
    format === "astro"
      ? "{/* Vivd newsletter plugin */}"
      : "<!-- Vivd newsletter plugin -->";
  const bodyFields = buildBodyFields(config);
  const heading =
    config.mode === "waitlist" ? "Join the waitlist" : "Subscribe";
  const buttonLabel =
    config.mode === "waitlist" ? "Join waitlist" : "Subscribe";
  const successMessage =
    config.mode === "waitlist"
      ? "Please check your email to confirm your waitlist signup."
      : "Please check your email to confirm your subscription.";
  const submitScript = buildSubmitScript({
    format,
    defaultButtonLabel: buttonLabel,
    successMessage,
  });

  return `${comment}
<div data-vivd-newsletter-form>
<form action="${escapeHtml(subscribeEndpoint)}" method="POST">
  <input type="hidden" name="token" value="${escapeHtml(token)}" />
  <div style="position:absolute;left:-9999px;opacity:0;pointer-events:none;" aria-hidden="true">
    <label>Leave this empty <input type="text" name="_honeypot" tabindex="-1" autocomplete="off" /></label>
  </div>
  <h3>${heading}</h3>
${bodyFields}  <button type="submit">${buttonLabel}</button>
</form>
<div data-vivd-status aria-live="polite" style="display:none"></div>
</div>
${submitScript}`;
}

export function getNewsletterSnippets(
  token: string,
  subscribeEndpoint: string,
  config: NewsletterPluginConfig,
): NewsletterSnippetSet {
  const html = formatSnippet(token, subscribeEndpoint, config, "html");
  const astro = formatSnippet(token, subscribeEndpoint, config, "astro");
  return { html, astro };
}
