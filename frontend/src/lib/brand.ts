export const BRAND_NAME = "Vivd";

export function formatDocumentTitle(pageTitle?: string) {
  if (!pageTitle) return BRAND_NAME;
  return `${BRAND_NAME} - ${pageTitle}`;
}

