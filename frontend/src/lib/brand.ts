export const BRAND_NAME = "vivd";

export function formatDocumentTitle(pageTitle?: string) {
  if (!pageTitle) return BRAND_NAME;
  return `${BRAND_NAME} - ${pageTitle}`;
}
