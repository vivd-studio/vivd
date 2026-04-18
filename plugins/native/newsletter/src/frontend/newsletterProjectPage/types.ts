import type { ComponentType } from "react";
import type { RouterOutputs } from "@/plugins/host";
import type {
  NewsletterCampaignsPayload,
  NewsletterSubscribersPayload,
  NewsletterSummaryPayload,
} from "../../shared/summary";

export type NewsletterProjectPageProps = {
  projectSlug: string;
  isEmbedded?: boolean;
};

export type NewsletterPluginConfig = {
  mode: "newsletter" | "waitlist";
  collectName: boolean;
  sourceHosts: string[];
  redirectHostAllowlist: string[];
};

export type NewsletterCampaignAudience = "all_confirmed" | "mode_confirmed";

export type NewsletterPluginInfo =
  | (RouterOutputs["plugins"]["info"] & {
      config: NewsletterPluginConfig | null;
      usage: {
        subscribeEndpoint: string;
        confirmEndpoint: string;
        unsubscribeEndpoint: string;
        expectedFields: string[];
        optionalFields: string[];
        inferredAutoSourceHosts: string[];
      } | null;
      snippets: {
        html: string;
        astro: string;
      } | null;
      details: {
        counts?: NewsletterSummaryPayload["counts"];
      } | null;
    })
  | undefined;

export type NewsletterCampaigns = NewsletterCampaignsPayload | undefined;
export type NewsletterSubscribers = NewsletterSubscribersPayload | undefined;
export type NewsletterSummary = NewsletterSummaryPayload | undefined;
export type NewsletterPluginIcon = ComponentType<{ className?: string }>;
export type NewsletterCampaignRecord =
  NewsletterCampaignsPayload["rows"][number];
export type NewsletterSubscriberRecord =
  NewsletterSubscribersPayload["rows"][number];
