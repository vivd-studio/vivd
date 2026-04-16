function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function getNewsletterSubscribeEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/newsletter/v1/subscribe`;
}

export function getNewsletterConfirmEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/newsletter/v1/confirm`;
}

export function getNewsletterUnsubscribeEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/newsletter/v1/unsubscribe`;
}
