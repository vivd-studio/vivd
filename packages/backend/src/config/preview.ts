export function getInternalPreviewAccessToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.PREVIEW_INTERNAL_TOKEN || env.SCRAPER_API_KEY;
}

