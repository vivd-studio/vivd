export const CONTACT_RECIPIENT_VERIFY_CONTROL_PLANE_PATH =
  "/vivd-studio/api/plugins/contact/v1/recipient-verify";

export class ContactRecipientVerificationEndpointUnavailableError extends Error {
  constructor() {
    super(
      "Recipient verification link is unavailable because no control-plane origin could be resolved.",
    );
    this.name = "ContactRecipientVerificationEndpointUnavailableError";
  }
}

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function buildContactFormSubmitEndpoint(baseUrl: string): string {
  return `${normalizeOrigin(baseUrl)}/plugins/contact/v1/submit`;
}

export function buildContactRecipientVerificationEndpoint(
  controlPlaneOrigin: string,
): string {
  const normalizedOrigin = normalizeOrigin(controlPlaneOrigin);
  if (normalizedOrigin) {
    return `${normalizedOrigin}${CONTACT_RECIPIENT_VERIFY_CONTROL_PLANE_PATH}`;
  }

  throw new ContactRecipientVerificationEndpointUnavailableError();
}

export function buildEmailFeedbackEndpoint(
  baseUrl: string,
  provider: string = "ses",
): string {
  const normalizedProvider = provider.trim().toLowerCase() || "ses";
  return `${normalizeOrigin(baseUrl)}/email/v1/feedback/${normalizedProvider}`;
}

export function getContactRecipientVerificationEndpoint(options?: {
  requestHost?: string | null;
}): string {
  const controlPlaneOrigin = options?.requestHost?.trim() || "";
  if (controlPlaneOrigin) {
    return buildContactRecipientVerificationEndpoint(controlPlaneOrigin);
  }

  throw new ContactRecipientVerificationEndpointUnavailableError();
}
