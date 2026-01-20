/**
 * Utility functions for detecting blocked, error, or invalid pages.
 * Used to identify when a scrape didn't capture meaningful content.
 */

export interface PageValidationResult {
  isValid: boolean;
  error?: {
    type: "cloudflare" | "access_denied" | "not_found" | "error_page" | "empty_content" | "bot_detection";
    message: string;
  };
}

/**
 * Cloudflare challenge page indicators
 */
const CLOUDFLARE_PATTERNS = [
  /checking if the site connection is secure/i,
  /just a moment\.\.\./i,
  /enable javascript and cookies to continue/i,
  /ray id:/i,
  /cloudflare/i,
  /cf-browser-verification/i,
  /please wait while we verify/i,
  /verifying you are human/i,
  /attention required!/i,
  /one more step/i,
  /please complete the security check/i,
  /ddos-guard/i,
  /checking your browser/i,
  /please turn javascript on/i,
  /please enable cookies/i,
];

/**
 * Access denied / forbidden page indicators
 */
const ACCESS_DENIED_PATTERNS = [
  /403 forbidden/i,
  /access denied/i,
  /you don't have permission/i,
  /you do not have permission/i,
  /not authorized/i,
  /unauthorized/i,
  /error 403/i,
];

/**
 * Not found page indicators
 */
const NOT_FOUND_PATTERNS = [
  /404 not found/i,
  /page not found/i,
  /error 404/i,
  /this page doesn't exist/i,
  /this page does not exist/i,
  /couldn't find that page/i,
  /could not find that page/i,
  /the page you requested/i,
  /page you're looking for/i,
];

/**
 * Generic error page indicators
 */
const ERROR_PAGE_PATTERNS = [
  /500 internal server error/i,
  /502 bad gateway/i,
  /503 service unavailable/i,
  /504 gateway timeout/i,
  /error 500/i,
  /error 502/i,
  /error 503/i,
  /error 504/i,
  /something went wrong/i,
  /an error occurred/i,
  /server error/i,
  /this site can't be reached/i,
  /connection timed out/i,
  /unable to connect/i,
];

/**
 * Bot detection / captcha indicators
 */
const BOT_DETECTION_PATTERNS = [
  /are you a robot/i,
  /prove you're human/i,
  /verify you're human/i,
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /bot protection/i,
  /automated access/i,
  /unusual traffic/i,
  /automated queries/i,
  /suspected bot/i,
];

/**
 * Minimum content length to consider a page as having meaningful content.
 * Pages with less text than this (after cleanup) are likely error pages.
 */
const MIN_MEANINGFUL_CONTENT_LENGTH = 200;

/**
 * Maximum percentage of the page that can be navigation/boilerplate
 * for very short pages (helps catch pages that only have header/footer)
 */
const MAX_BOILERPLATE_RATIO = 0.8;

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

/**
 * Validates page content to determine if a meaningful page was captured.
 *
 * @param text - The extracted text content from the page
 * @param htmlContent - Optional raw HTML for additional validation
 * @returns Validation result indicating if page is valid and any error details
 */
export function validatePageContent(
  text: string,
  htmlContent?: string
): PageValidationResult {
  const normalizedText = text.trim();
  const contentToCheck = normalizedText + (htmlContent || "");

  // Check for Cloudflare challenge (most common blocker in deployed environments)
  const cloudflareMatches = countPatternMatches(contentToCheck, CLOUDFLARE_PATTERNS);
  if (cloudflareMatches >= 2) {
    return {
      isValid: false,
      error: {
        type: "cloudflare",
        message: "The website is protected by Cloudflare and blocked the scraper. Try a different URL or wait and retry.",
      },
    };
  }

  // Check for bot detection / captcha
  const botMatches = countPatternMatches(contentToCheck, BOT_DETECTION_PATTERNS);
  if (botMatches >= 2) {
    return {
      isValid: false,
      error: {
        type: "bot_detection",
        message: "The website detected automated access and requires human verification.",
      },
    };
  }

  // Check for access denied
  if (matchesAnyPattern(contentToCheck, ACCESS_DENIED_PATTERNS)) {
    return {
      isValid: false,
      error: {
        type: "access_denied",
        message: "Access to the website was denied (403 Forbidden).",
      },
    };
  }

  // Check for not found
  if (matchesAnyPattern(contentToCheck, NOT_FOUND_PATTERNS) && normalizedText.length < 1000) {
    return {
      isValid: false,
      error: {
        type: "not_found",
        message: "The page was not found (404). Check if the URL is correct.",
      },
    };
  }

  // Check for error pages
  if (matchesAnyPattern(contentToCheck, ERROR_PAGE_PATTERNS)) {
    return {
      isValid: false,
      error: {
        type: "error_page",
        message: "The website returned an error page. The site may be temporarily unavailable.",
      },
    };
  }

  // Check for empty or minimal content
  if (normalizedText.length < MIN_MEANINGFUL_CONTENT_LENGTH) {
    return {
      isValid: false,
      error: {
        type: "empty_content",
        message: "The page appears to be empty or contains very little content. The website may require JavaScript or is blocking scrapers.",
      },
    };
  }

  // Additional check: if content is short and looks like just navigation
  // This catches cases where only header/footer was captured
  if (normalizedText.length < 500) {
    const lines = normalizedText.split("\n").filter((l) => l.trim().length > 0);
    const shortLines = lines.filter((l) => l.trim().length < 30);
    if (lines.length > 0 && shortLines.length / lines.length > MAX_BOILERPLATE_RATIO) {
      return {
        isValid: false,
        error: {
          type: "empty_content",
          message: "The page content appears to be only navigation or boilerplate. The main content may not have loaded.",
        },
      };
    }
  }

  return { isValid: true };
}

/**
 * Quick check for obvious blocking indicators in raw HTML.
 * Can be used before full text extraction for early bailout.
 */
export function quickBlockCheck(html: string): boolean {
  // Check for meta refresh to challenge page
  if (/<meta[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) {
    // Cloudflare often uses meta refresh
    if (/challenge/i.test(html) || /cloudflare/i.test(html)) {
      return true;
    }
  }

  // Check for Cloudflare-specific elements
  if (/<div[^>]*id\s*=\s*["']?cf-/i.test(html)) {
    return true;
  }

  // Check for challenge form
  if (/<form[^>]*id\s*=\s*["']?challenge-form/i.test(html)) {
    return true;
  }

  return false;
}
