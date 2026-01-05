/**
 * Types for the pre-publish checklist feature.
 * Used by the agent to validate production readiness.
 */

export type ChecklistStatus = "pass" | "fail" | "warning" | "skip" | "fixed";

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string; // What's missing, what needs to be done, or what was fixed
}

export interface PrePublishChecklist {
  projectSlug: string;
  version: number;
  runAt: string; // ISO timestamp
  items: ChecklistItem[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    fixed?: number; // Items marked as fixed by agent, pending re-verification
  };
}

/**
 * The checklist items to check for production readiness.
 * Based on implementation.md Production Checklist.
 */
export const CHECKLIST_ITEMS = [
  { id: "impressum", label: "Impressum/Imprint page exists and is linked" },
  { id: "privacy", label: "Datenschutz/Privacy policy exists and is linked" },
  { id: "cookie_banner", label: "Cookie consent banner (if cookies are used)" },
  { id: "sitemap", label: "sitemap.xml file exists" },
  { id: "robots", label: "robots.txt file exists" },
  { id: "favicon", label: "Favicon is set" },
  { id: "404_page", label: "Custom 404.html error page exists" },
  { id: "navigation", label: "All navigation links work (no broken links)" },
  { id: "contact_form", label: "Contact form is functional (if present)" },
  { id: "seo_meta", label: "SEO meta tags (title, description, OG tags)" },
  { id: "alt_text", label: "Images have alt text attributes" },
] as const;

/**
 * The prompt template for the pre-publish checklist agent.
 */
export const CHECKLIST_PROMPT = `You are a rigorous website QA auditor reviewing a project for production readiness.

Your job is to CAREFULLY analyze the project files and verify each item. Be SKEPTICAL - don't assume something exists just because there's a reference to it. Actually verify the content.

## Checklist Items to Verify

1. **impressum** - Does an Impressum/Imprint page EXIST as a separate HTML file (e.g., impressum.html, imprint.html)? Is it linked from the main navigation or footer? Does it contain ACTUAL contact information (not placeholder text)?

2. **privacy** - Does a Datenschutz/Privacy policy page EXIST as a separate HTML file? Is it linked? Does it contain REAL privacy policy content (not lorem ipsum)?

3. **cookie_banner** - ONLY mark as "pass" if you find:
   - An actual cookie consent UI element (banner, modal, popup) in the HTML
   - JavaScript code that handles consent (not just a reference to cookies)
   - Mark as "skip" if no cookies/analytics scripts are used at all
   - Mark as "fail" if cookies ARE used but no consent mechanism exists

4. **sitemap** - Does sitemap.xml file exist? Does it contain valid URLs for the site's pages?

5. **robots** - Does robots.txt file exist? Is it properly formatted?

6. **favicon** - Is there a favicon.ico file OR a <link rel="icon"> tag in the HTML <head>?

7. **404_page** - Does a custom 404.html error page exist? Is it styled and user-friendly?

8. **navigation** - Check all internal links (<a href="...">). Do all linked files exist? Are there any broken links?

9. **contact_form** - If a contact form exists, does it have proper form handling (action URL, email submission)?

10. **seo_meta** - Are these present in the HTML <head>: <title>, <meta name="description">, Open Graph tags (og:title, og:description)?

11. **alt_text** - Do ALL <img> tags have meaningful alt attributes (not empty, not generic)?

## Response Requirements

BE HONEST. If you're unsure or can't find something, mark it as "fail" or "warning" with an explanation.

Respond with ONLY a valid JSON object (no markdown, no explanation outside JSON):

{
  "items": [
    {"id": "impressum", "label": "Impressum page", "status": "pass|fail|warning|skip", "note": "Specific evidence or what's missing"},
    ...for all 11 items...
  ]
}

Status guide:
- "pass": Verified the item exists AND is correct/complete
- "fail": Item is missing, broken, or contains placeholder content
- "warning": Item exists but has issues (e.g., empty alt texts, placeholder text)
- "skip": Item genuinely not applicable (e.g., no cookies used = no banner needed)

CRITICAL: Verify by actually reading file contents, not just file names. Look for placeholder text like "Lorem ipsum", "[Your Name]", "example.com" etc.
`;
