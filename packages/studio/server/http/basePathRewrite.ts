function rewriteRootRelativeUrl(
  value: string,
  base: string,
  escapedBaseNoLeadingSlash: string,
): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    new RegExp(`^/${escapedBaseNoLeadingSlash}(?:/|$)`).test(value)
  ) {
    return value;
  }

  return `${base}${value}`;
}

function rewriteSrcsetValue(
  srcset: string,
  base: string,
  escapedBaseNoLeadingSlash: string,
): string {
  return srcset
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return candidate;

      const [urlPart, ...descriptorParts] = trimmed.split(/\s+/);
      const rewrittenUrl = rewriteRootRelativeUrl(
        urlPart,
        base,
        escapedBaseNoLeadingSlash,
      );
      return [rewrittenUrl, ...descriptorParts].filter(Boolean).join(" ");
    })
    .join(", ");
}

function rewriteCssRootRelativeUrls(
  text: string,
  base: string,
  escapedBaseNoLeadingSlash: string,
): string {
  return text.replace(
    new RegExp(
      String.raw`url\(\s*(["']?)\/(?!\/)(?!${escapedBaseNoLeadingSlash}(?:\/|$))`,
      "g",
    ),
    `url($1${base}/`,
  );
}

export function rewriteRootAssetUrlsInText(text: string, basePath: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const baseNoLeadingSlash = base.replace(/^\/+/, "");
  const escapedBaseNoLeadingSlash = baseNoLeadingSlash.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const rewriteCommonAttributes = (input: string) =>
    input.replace(
      /\b(href|src|action|poster|data|content)=(["'])([^"']*)\2/g,
      (match, attribute, quote, value) => {
        const rewrittenValue = rewriteRootRelativeUrl(
          value,
          base,
          escapedBaseNoLeadingSlash,
        );
        return rewrittenValue === value
          ? match
          : `${attribute}=${quote}${rewrittenValue}${quote}`;
      },
    );

  const rewriteSrcsetAttributes = (input: string) =>
    input.replace(/\bsrcset=(["'])([^"']*)\1/g, (match, quote, value) => {
      const rewrittenValue = rewriteSrcsetValue(
        value,
        base,
        escapedBaseNoLeadingSlash,
      );
      return rewrittenValue === value ? match : `srcset=${quote}${rewrittenValue}${quote}`;
    });

  const rewriteStyleAttributes = (input: string) =>
    input.replace(/\bstyle=(["'])([^"']*)\1/g, (match, quote, value) => {
      const rewrittenValue = rewriteCssRootRelativeUrls(
        value,
        base,
        escapedBaseNoLeadingSlash,
      );
      return rewrittenValue === value ? match : `style=${quote}${rewrittenValue}${quote}`;
    });

  const rewriteRootRelativeJsNavigations = (input: string) =>
    input
      .replace(
        /\b(const|let|var)\s+baseUrl\s*=\s*(["'])\/\2/g,
        `$1 baseUrl = $2${base}/$2`,
      )
      .replace(
        /\bbaseUrl\s*=\s*(["'])\/\1/g,
        `baseUrl = "${base.replace(/"/g, '\\"')}/"`,
      )
      .replace(
        new RegExp(
          String.raw`(\b(?:window\.)?location\.(?:assign|replace)\(\s*)(["'])\/(?!\/)(?!${escapedBaseNoLeadingSlash}(?:\/|$))`,
          "g",
        ),
        `$1$2${base}/`,
      )
      .replace(
        new RegExp(
          String.raw`(\b(?:window\.)?location\.(?:href|pathname)\s*=\s*)(["'])\/(?!\/)(?!${escapedBaseNoLeadingSlash}(?:\/|$))`,
          "g",
        ),
        `$1$2${base}/`,
      );

  const prefixGroups = [
    "images",
    "_astro",
    "@vite",
    "@id",
    "src",
    "node_modules",
    "@fs",
    "assets",
  ].join("|");

  return rewriteCssRootRelativeUrls(
    rewriteRootRelativeJsNavigations(
      rewriteStyleAttributes(rewriteSrcsetAttributes(rewriteCommonAttributes(text))),
    )
      .replace(
        new RegExp(`(^|[^\\w/])\\/(${prefixGroups})\\/`, "g"),
        `$1${base}/$2/`,
      )
      .replace(
        /(^|[^\w/])\/(favicon(?:-[^"'`()\s,]+)?\.(?:ico|png|svg))\b/g,
        `$1${base}/$2`,
      ),
    base,
    escapedBaseNoLeadingSlash,
  );
}

export function stripDevServerToolingFromHtml(html: string): string {
  return html
    .replace(
      /<script\b[^>]*\bsrc=(["'])([^"']*\/@vite\/client[^"']*)\1[^>]*>\s*<\/script>/gi,
      "",
    )
    .replace(
      /<script\b[^>]*\bsrc=(["'])([^"']*dev-toolbar\/entrypoint\.js[^"']*)\1[^>]*>\s*<\/script>/gi,
      "",
    )
    .replace(
      /<link\b[^>]*\bhref=(["'])([^"']*\/@vite\/client[^"']*)\1[^>]*>/gi,
      "",
    )
    .replace(
      /<link\b[^>]*\bhref=(["'])([^"']*dev-toolbar\/[^"']*)\1[^>]*>/gi,
      ""
    );
}

function createBasePathRewriteScript(basePath: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  return `<script data-vivd-basepath>(function(B){if(window.__vivdBasePath)return;window.__vivdBasePath=B;var defined=function(x){return typeof x!=='undefined'};var shouldRewrite=function(u){if(!u||typeof u!=='string')return false;if(u===B||u.startsWith(B+'/')||u.startsWith('//')||u.startsWith('http:')||u.startsWith('https:')||u.startsWith('#')||u.startsWith('mailto:')||u.startsWith('tel:')||u.startsWith('javascript:')||u.startsWith('data:'))return false;return u.startsWith('/');};var rewrite=function(u){return shouldRewrite(u)?B+u:u;};document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(a){var h=a.getAttribute('href');var isDownload=a.hasAttribute('download');var isPdf=h&&/\\.pdf(?:[?#&]|$)/i.test(h);if(isDownload||isPdf){if(shouldRewrite(h))a.setAttribute('href',rewrite(h));return;}if(shouldRewrite(h)){e.preventDefault();window.location.href=rewrite(h);}}},true);document.addEventListener('submit',function(e){var f=e.target;if(f&&f.tagName==='FORM'){var action=f.getAttribute('action');if(shouldRewrite(action))f.setAttribute('action',rewrite(action));}},true);if(defined(window.fetch)){var oFetch=window.fetch;window.fetch=function(u,o){return oFetch(rewrite(typeof u==='string'?u:u),o);};}if(defined(window.XMLHttpRequest)){var oOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return oOpen.call(this,m,rewrite(u));};}if(defined(window.history)){var oPush=history.pushState;var oReplace=history.replaceState;history.pushState=function(s,t,u){return oPush.call(this,s,t,rewrite(u));};history.replaceState=function(s,t,u){return oReplace.call(this,s,t,rewrite(u));};}})('${base}');</script>`;
}

export function injectBasePathScript(html: string, basePath: string): string {
  const script = createBasePathRewriteScript(basePath);
  const headMatch = html.match(/<head(\s[^>]*)?>|<head>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertPos = headMatch.index + headMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }

  const doctypeMatch = html.match(/<!DOCTYPE[^>]*>/i);
  if (doctypeMatch && doctypeMatch.index !== undefined) {
    const insertPos = doctypeMatch.index + doctypeMatch[0].length;
    return html.slice(0, insertPos) + script + html.slice(insertPos);
  }

  return script + html;
}
