function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function getTableBookingAvailabilityEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/table-booking/v1/availability`;
}

export function getTableBookingBookEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/table-booking/v1/book`;
}

export function getTableBookingCancelEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins/table-booking/v1/cancel`;
}
