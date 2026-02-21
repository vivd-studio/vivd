export interface EmailDeliveryRequest {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
}

export interface EmailDeliveryResult {
  accepted: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

export interface EmailDeliveryService {
  readonly providerName: string;
  send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult>;
}

class NoopEmailDeliveryService implements EmailDeliveryService {
  readonly providerName = "noop";

  async send(_request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    return {
      accepted: true,
      provider: this.providerName,
      messageId: `noop-${Date.now()}`,
    };
  }
}

const noopEmailDeliveryService = new NoopEmailDeliveryService();

export function getEmailDeliveryService(): EmailDeliveryService {
  const provider = (process.env.EMAIL_PROVIDER || "noop").trim().toLowerCase();

  if (provider === "noop") return noopEmailDeliveryService;

  console.warn(
    `[EmailDeliveryService] Unsupported EMAIL_PROVIDER="${provider}". Falling back to noop provider.`,
  );
  return noopEmailDeliveryService;
}
