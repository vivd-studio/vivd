import { AlertTriangle, CheckCircle2, SkipForward, XCircle } from "lucide-react";
import type { ChecklistStatus, PreviewChecklistItem } from "./types";

type ChecklistIcon = typeof CheckCircle2;

export const CHECKLIST_STATUS_CONFIG: Record<
  ChecklistStatus,
  { icon: ChecklistIcon; color: string; bgColor: string }
> = {
  pass: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-900/20",
  },
  fail: {
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-900/20",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
  },
  skip: {
    icon: SkipForward,
    color: "text-gray-500 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-800/50",
  },
  fixed: {
    icon: CheckCircle2,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
};

export const PREVIEW_CHECKLIST_ITEMS: PreviewChecklistItem[] = [
  { id: "impressum", label: "Impressum/Imprint page" },
  { id: "privacy", label: "Privacy policy page" },
  { id: "cookie_banner", label: "Cookie consent banner" },
  { id: "sitemap", label: "sitemap.xml file" },
  { id: "robots", label: "robots.txt file" },
  { id: "favicon", label: "Favicon" },
  { id: "404_page", label: "Custom 404 error page" },
  { id: "navigation", label: "Working navigation links" },
  { id: "contact_form", label: "Contact form functionality" },
  { id: "seo_meta", label: "SEO meta tags" },
  { id: "alt_text", label: "Image alt text" },
];

