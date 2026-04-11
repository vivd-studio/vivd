import {
  buildContactFormSubmitEndpoint,
  buildContactRecipientVerificationEndpoint,
  buildEmailFeedbackEndpoint,
  ContactRecipientVerificationEndpointUnavailableError,
} from "@vivd/plugin-contact-form/backend/publicApi";
import { getControlPlaneOrigin, getPublicPluginApiBaseUrl } from "../runtime/publicApi";

export {
  ContactRecipientVerificationEndpointUnavailableError,
} from "@vivd/plugin-contact-form/backend/publicApi";
export { getPublicPluginApiBaseUrl } from "../runtime/publicApi";

export async function getContactFormSubmitEndpoint(options?: {
  requestHost?: string | null;
}): Promise<string> {
  return buildContactFormSubmitEndpoint(await getPublicPluginApiBaseUrl(options));
}

export function getContactRecipientVerificationEndpoint(options?: {
  requestHost?: string | null;
}): string {
  const controlPlaneOrigin = getControlPlaneOrigin(options);
  if (controlPlaneOrigin) {
    return buildContactRecipientVerificationEndpoint(controlPlaneOrigin);
  }

  throw new ContactRecipientVerificationEndpointUnavailableError();
}

export async function getEmailFeedbackEndpoint(
  provider: string = "ses",
  options?: { requestHost?: string | null },
): Promise<string> {
  return buildEmailFeedbackEndpoint(
    await getPublicPluginApiBaseUrl(options),
    provider,
  );
}
