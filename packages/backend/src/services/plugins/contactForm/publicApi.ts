import {
  getControlPlaneOrigin,
  getPublicPluginApiBaseUrl,
} from "../runtime/publicApi";

const CONTACT_RECIPIENT_VERIFY_CONTROL_PLANE_PATH =
  "/vivd-studio/api/plugins/contact/v1/recipient-verify";

export { getPublicPluginApiBaseUrl } from "../runtime/publicApi";

export class ContactRecipientVerificationEndpointUnavailableError extends Error {
  constructor() {
    super(
      "Recipient verification link is unavailable because no control-plane origin could be resolved.",
    );
    this.name = "ContactRecipientVerificationEndpointUnavailableError";
  }
}

export async function getContactFormSubmitEndpoint(options?: {
  requestHost?: string | null;
}): Promise<string> {
  return `${await getPublicPluginApiBaseUrl(options)}/plugins/contact/v1/submit`;
}

export function getContactRecipientVerificationEndpoint(options?: {
  requestHost?: string | null;
}): string {
  const controlPlaneOrigin = getControlPlaneOrigin(options);
  if (controlPlaneOrigin) {
    return `${controlPlaneOrigin}${CONTACT_RECIPIENT_VERIFY_CONTROL_PLANE_PATH}`;
  }

  throw new ContactRecipientVerificationEndpointUnavailableError();
}

export async function getEmailFeedbackEndpoint(
  provider: string = "ses",
  options?: { requestHost?: string | null },
): Promise<string> {
  const normalizedProvider = provider.trim().toLowerCase() || "ses";
  return `${await getPublicPluginApiBaseUrl(options)}/email/v1/feedback/${normalizedProvider}`;
}
