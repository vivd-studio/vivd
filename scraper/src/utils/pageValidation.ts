/**
 * Utility functions for detecting blocked, error, or invalid pages.
 * Uses HTTP status codes as primary signal, with text patterns as fallback
 * for cases like Cloudflare challenges that return 200 status.
 */

export interface PageValidationResult {
  isValid: boolean;
  error?: {
    type: "cloudflare" | "access_denied" | "not_found" | "error_page" | "bot_detection";
    message: string;
  };
}

/**
 * Cloudflare challenge page indicators.
 * These are specific to CF challenge pages, not general mentions of Cloudflare.
 */
const CLOUDFLARE_CHALLENGE_PATTERNS = [
  /checking if the site connection is secure/i,
  /please wait while we verify/i,
  /verifying you are human/i,
  /please complete the security check/i,
  /checking your browser/i,
  /cf-browser-verification/i,
  /enable javascript and cookies to continue/i,
];

/**
 * Bot detection / captcha indicators
 */
const BOT_DETECTION_PATTERNS = [
  /are you a robot/i,
  /prove you're human/i,
  /verify you're human/i,
  /recaptcha/i,
  /hcaptcha/i,
  /bot protection/i,
  /unusual traffic/i,
];

function countPatternMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

/**
 * Validates page content to determine if a meaningful page was captured.
 *
 * @param text - The extracted text content from the page
 * @param htmlContent - Optional raw HTML for additional validation
 * @param httpStatus - HTTP status code from navigation (most reliable signal)
 * @returns Validation result indicating if page is valid and any error details
 */
export function validatePageContent(
  text: string,
  htmlContent?: string,
  httpStatus?: number | null
): PageValidationResult {
  const normalizedText = text.trim();
  const contentToCheck = normalizedText + (htmlContent || "");

  // === PRIMARY: Use HTTP status code (most reliable) ===

  if (httpStatus) {
    // 403 Forbidden
    if (httpStatus === 403) {
      return {
        isValid: false,
        error: {
          type: "access_denied",
          message: "Access to the website was denied (403 Forbidden).",
        },
      };
    }

    // 404 Not Found
    if (httpStatus === 404) {
      return {
        isValid: false,
        error: {
          type: "not_found",
          message: "The page was not found (404). Check if the URL is correct.",
        },
      };
    }

    // 5xx Server errors
    if (httpStatus >= 500 && httpStatus < 600) {
      return {
        isValid: false,
        error: {
          type: "error_page",
          message: `The website returned a server error (${httpStatus}). The site may be temporarily unavailable.`,
        },
      };
    }
  }

  // === SECONDARY: Text-based detection for challenges that return 200 ===

  // Cloudflare challenge pages return 200 but show a challenge.
  // They have very little actual content (< 500 chars typically) and specific phrases.
  const cloudflareMatches = countPatternMatches(contentToCheck, CLOUDFLARE_CHALLENGE_PATTERNS);
  const hasCloudflareHtmlElements = quickBlockCheck(htmlContent || "");

  // Require: CF HTML elements OR 2+ CF text patterns, AND minimal content
  if ((hasCloudflareHtmlElements || cloudflareMatches >= 2) && normalizedText.length < 1000) {
    return {
      isValid: false,
      error: {
        type: "cloudflare",
        message: "The website is protected by Cloudflare and blocked the scraper. Try a different URL or wait and retry.",
      },
    };
  }

  // Bot detection / captcha (also returns 200 typically)
  // Require 2+ matches AND minimal content
  const botMatches = countPatternMatches(contentToCheck, BOT_DETECTION_PATTERNS);
  if (botMatches >= 2 && normalizedText.length < 1500) {
    return {
      isValid: false,
      error: {
        type: "bot_detection",
        message: "The website detected automated access and requires human verification.",
      },
    };
  }

  return { isValid: true };
}

/**
 * Quick check for Cloudflare-specific HTML elements.
 * These are reliable indicators of a CF challenge page.
 */
export function quickBlockCheck(html: string): boolean {
  if (!html) return false;

  // Check for meta refresh to challenge page
  if (/<meta[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) {
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
