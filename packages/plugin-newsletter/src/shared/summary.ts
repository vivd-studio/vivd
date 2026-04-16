import type { PluginReadDefinition } from "@vivd/plugin-sdk";
import { z } from "zod";

export const NEWSLETTER_SUMMARY_READ_ID = "summary";
export const NEWSLETTER_SUBSCRIBERS_READ_ID = "subscribers";

export const newsletterSummaryRangeSchema = z.union([
  z.literal(7),
  z.literal(30),
]);

export const newsletterSummaryReadInputSchema = z.object({
  rangeDays: newsletterSummaryRangeSchema.default(30),
});

export const newsletterSubscriberStatusSchema = z.enum([
  "all",
  "pending",
  "confirmed",
  "unsubscribed",
  "bounced",
  "complained",
]);

export const newsletterSubscribersReadInputSchema = z.object({
  status: newsletterSubscriberStatusSchema.default("all"),
  search: z.string().trim().max(160).default(""),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type NewsletterSummaryRange = z.infer<
  typeof newsletterSummaryRangeSchema
>;
export type NewsletterSummaryReadInput = z.infer<
  typeof newsletterSummaryReadInputSchema
>;
export type NewsletterSubscribersReadInput = z.infer<
  typeof newsletterSubscribersReadInputSchema
>;
export type NewsletterSubscriberFilterStatus = z.infer<
  typeof newsletterSubscriberStatusSchema
>;

export const newsletterSummaryReadDefinition = {
  readId: NEWSLETTER_SUMMARY_READ_ID,
  title: "Summary",
  description:
    "Load the high-level newsletter subscriber summary for a trailing day range.",
  arguments: [
    {
      name: "rangeDays",
      type: "integer",
      required: false,
      description: "Trailing day range to query.",
      allowedValues: [7, 30],
      defaultValue: 30,
    },
  ],
} satisfies PluginReadDefinition;

export const newsletterSubscribersReadDefinition = {
  readId: NEWSLETTER_SUBSCRIBERS_READ_ID,
  title: "Subscribers",
  description:
    "List subscribers with optional status, search, limit, and offset filters.",
  arguments: [
    {
      name: "status",
      type: "string",
      required: false,
      description: "Filter by subscriber lifecycle state.",
      allowedValues: [
        "all",
        "pending",
        "confirmed",
        "unsubscribed",
        "bounced",
        "complained",
      ],
      defaultValue: "all",
    },
    {
      name: "search",
      type: "string",
      required: false,
      description: "Case-insensitive email or name search.",
      defaultValue: "",
    },
    {
      name: "limit",
      type: "integer",
      required: false,
      description: "Maximum rows to return.",
      defaultValue: 50,
    },
    {
      name: "offset",
      type: "integer",
      required: false,
      description: "Pagination offset.",
      defaultValue: 0,
    },
  ],
} satisfies PluginReadDefinition;

export interface NewsletterSummaryPayload {
  pluginId: "newsletter";
  enabled: boolean;
  rangeDays: NewsletterSummaryRange;
  counts: {
    total: number;
    pending: number;
    confirmed: number;
    unsubscribed: number;
    bounced: number;
    complained: number;
  };
  recent: {
    signups: number;
    confirmations: number;
    unsubscribes: number;
  };
}

export interface NewsletterSubscriberRecord {
  id: string;
  email: string;
  name: string | null;
  status: NewsletterSubscriberFilterStatus | Exclude<NewsletterSubscriberFilterStatus, "all">;
  sourceHost: string | null;
  sourcePath: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  lastSignupAt: string | null;
  lastConfirmationSentAt: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewsletterSubscribersPayload {
  pluginId: "newsletter";
  enabled: boolean;
  status: NewsletterSubscriberFilterStatus;
  search: string;
  total: number;
  limit: number;
  offset: number;
  rows: NewsletterSubscriberRecord[];
}
