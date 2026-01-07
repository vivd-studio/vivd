export const BRAND_NAME = "vivd";

const ENV_PREFIX = (() => {
  const env = (
    import.meta.env.VITE_APP_ENV || import.meta.env.MODE
  )?.toLowerCase();
  if (env?.includes("staging")) return "(staging) ";
  if (env?.includes("local") || env?.includes("dev")) return "(local) ";
  return "";
})();

export function formatDocumentTitle(pageTitle?: string) {
  if (!pageTitle) return `${ENV_PREFIX}${BRAND_NAME}`;
  return `${ENV_PREFIX}${BRAND_NAME} - ${pageTitle}`;
}
