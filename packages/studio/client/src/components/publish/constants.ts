import {
  AlertTriangle,
  CheckCircle2,
  SkipForward,
  XCircle,
} from "lucide-react";
import type { ChecklistStatus, PreviewChecklistItem } from "./types";

type ChecklistIcon = typeof CheckCircle2;

export const CHECKLIST_PENDING_NOTE_MARKER = "[[PENDING_AGENT_REVIEW]]";

export const CHECKLIST_STATUS_CONFIG: Record<
  ChecklistStatus,
  { icon: ChecklistIcon; color: string; bgColor: string }
> = {
  pass: {
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "border-emerald-500/30 bg-emerald-500/10",
  },
  fail: {
    icon: XCircle,
    color: "text-destructive",
    bgColor: "border-destructive/30 bg-destructive/10",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "border-amber-500/30 bg-amber-500/10",
  },
  skip: {
    icon: SkipForward,
    color: "text-muted-foreground",
    bgColor: "border-border bg-surface-sunken",
  },
  fixed: {
    icon: CheckCircle2,
    color: "text-primary",
    bgColor: "border-primary/30 bg-primary/10",
  },
};

export const PREVIEW_CHECKLIST_ITEMS: PreviewChecklistItem[] = [
  // Mandatory items
  { id: "imprint", label: "Imprint (Impressum) page" },
  { id: "privacy", label: "Privacy policy page" },
  { id: "favicon", label: "Favicon" },
  { id: "seo_meta", label: "SEO & share preview meta tags" },
  { id: "navigation", label: "Working navigation links" },
  { id: "alt_text", label: "Image alt text" },
  // Optional items
  { id: "cookie_banner", label: "Cookie consent banner" },
  { id: "sitemap", label: "sitemap.xml file" },
  { id: "robots", label: "robots.txt file" },
  { id: "404_page", label: "Custom 404 error page" },
  { id: "contact_form", label: "Contact form functionality" },
  { id: "other_issues", label: "Other issues" },
];
