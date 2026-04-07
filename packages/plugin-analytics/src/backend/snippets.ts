export interface AnalyticsSnippetSet {
  html: string;
  astro: string;
}

export function getAnalyticsSnippets(
  token: string,
  scriptEndpoint: string,
): AnalyticsSnippetSet {
  const scriptUrl = `${scriptEndpoint}?token=${encodeURIComponent(token)}`;

  return {
    html: `<!-- Vivd analytics plugin -->\n<script async src="${scriptUrl}"></script>`,
    astro:
      `{/* Vivd analytics plugin */}\n` +
      `<script async src=\"${scriptUrl}\"></script>`,
  };
}
