import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { Resend, type CreateEmailOptions } from "resend";

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

type PreparedEmailRequest = {
  recipients: string[];
  fromEmail: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
};

const MISSING_SENDER_EMAIL_MESSAGE =
  "Missing sender email (set request.from or VIVD_EMAIL_FROM or VIVD_FROM_EMAIL or VIVD_SMTP_FROM_EMAIL or VIVD_SES_FROM_EMAIL)";

function normalizeRecipients(recipients: string[]): string[] {
  return recipients
    .map((recipient) => recipient.trim())
    .filter((recipient) => recipient.length > 0);
}

function prepareEmailRequest(
  request: EmailDeliveryRequest,
  defaultFromEmail: string | null,
): { ok: true; value: PreparedEmailRequest } | { ok: false; error: string } {
  const recipients = normalizeRecipients(request.to);
  if (recipients.length === 0) {
    return { ok: false, error: "No recipient email configured" };
  }

  const fromEmail = request.from?.trim() || defaultFromEmail;
  if (!fromEmail) {
    return { ok: false, error: MISSING_SENDER_EMAIL_MESSAGE };
  }

  const subject = request.subject.trim();
  if (!subject) {
    return { ok: false, error: "Email subject is required" };
  }

  const textBody = request.text?.trim() || undefined;
  const htmlBody = request.html?.trim() || undefined;
  if (!textBody && !htmlBody) {
    return { ok: false, error: "Email body is required" };
  }

  return {
    ok: true,
    value: {
      recipients,
      fromEmail,
      subject,
      textBody,
      htmlBody,
      replyTo: request.replyTo?.trim() || undefined,
      metadata: request.metadata,
    },
  };
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

class SmtpEmailDeliveryService implements EmailDeliveryService {
  readonly providerName = "smtp";
  private readonly transporter: Transporter;
  private readonly defaultFromEmail: string | null;

  constructor(transporter: Transporter, defaultFromEmail: string | null) {
    this.transporter = transporter;
    this.defaultFromEmail = defaultFromEmail;
  }

  async send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    const prepared = prepareEmailRequest(request, this.defaultFromEmail);
    if (!prepared.ok) {
      return {
        accepted: false,
        provider: this.providerName,
        error: "error" in prepared ? prepared.error : "Invalid email request",
      };
    }

    const { recipients, fromEmail, replyTo, subject, textBody, htmlBody } = prepared.value;

    try {
      const payload: SendMailOptions = {
        from: fromEmail,
        to: recipients,
        replyTo,
        subject,
        ...(textBody ? { text: textBody } : {}),
        ...(htmlBody ? { html: htmlBody } : {}),
      };
      const result = await this.transporter.sendMail(payload);

      return {
        accepted: true,
        provider: this.providerName,
        messageId: result.messageId || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        provider: this.providerName,
        error: message,
      };
    }
  }
}

class SesEmailDeliveryService implements EmailDeliveryService {
  readonly providerName = "ses";
  private readonly client: SESv2Client;
  private readonly defaultFromEmail: string | null;

  constructor(client: SESv2Client, defaultFromEmail: string | null) {
    this.client = client;
    this.defaultFromEmail = defaultFromEmail;
  }

  async send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    const prepared = prepareEmailRequest(request, this.defaultFromEmail);
    if (!prepared.ok) {
      return {
        accepted: false,
        provider: this.providerName,
        error: "error" in prepared ? prepared.error : "Invalid email request",
      };
    }
    const { recipients, fromEmail, replyTo, subject, textBody, htmlBody, metadata } =
      prepared.value;

    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: fromEmail,
          Destination: {
            ToAddresses: recipients,
          },
          ReplyToAddresses: replyTo ? [replyTo] : undefined,
          Content: {
            Simple: {
              Subject: {
                Data: subject,
                Charset: "UTF-8",
              },
              Body: {
                Text: textBody
                  ? {
                      Data: textBody,
                      Charset: "UTF-8",
                    }
                  : undefined,
                Html: htmlBody
                  ? {
                      Data: htmlBody,
                      Charset: "UTF-8",
                    }
                  : undefined,
              },
            },
          },
          EmailTags: toSesTags(metadata),
        }),
      );

      return {
        accepted: true,
        provider: this.providerName,
        messageId: result.MessageId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        provider: this.providerName,
        error: message,
      };
    }
  }
}

class ResendEmailDeliveryService implements EmailDeliveryService {
  readonly providerName = "resend";
  private readonly client: Resend;
  private readonly defaultFromEmail: string | null;

  constructor(client: Resend, defaultFromEmail: string | null) {
    this.client = client;
    this.defaultFromEmail = defaultFromEmail;
  }

  async send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    const prepared = prepareEmailRequest(request, this.defaultFromEmail);
    if (!prepared.ok) {
      return {
        accepted: false,
        provider: this.providerName,
        error: "error" in prepared ? prepared.error : "Invalid email request",
      };
    }
    const { recipients, fromEmail, replyTo, subject, textBody, htmlBody, metadata } =
      prepared.value;

    try {
      const tags = toResendTags(metadata);
      const payloadBase = {
        from: fromEmail,
        to: recipients,
        replyTo,
        subject,
        ...(tags ? { tags } : {}),
      };
      const payload: CreateEmailOptions = textBody
        ? {
            ...payloadBase,
            text: textBody,
            ...(htmlBody ? { html: htmlBody } : {}),
          }
        : {
            ...payloadBase,
            html: htmlBody!,
          };

      const result = await this.client.emails.send(payload);

      if (result.error) {
        return {
          accepted: false,
          provider: this.providerName,
          error: result.error.message,
        };
      }

      if (!result.data?.id) {
        return {
          accepted: false,
          provider: this.providerName,
          error: "Resend did not return a message id",
        };
      }

      return {
        accepted: true,
        provider: this.providerName,
        messageId: result.data.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        provider: this.providerName,
        error: message,
      };
    }
  }
}

const noopEmailDeliveryService = new NoopEmailDeliveryService();
let cachedEmailService: EmailDeliveryService | null = null;
let cachedEmailServiceKey: string | null = null;

function toSesTags(metadata: Record<string, string> | undefined) {
  if (!metadata) return undefined;

  const tags = Object.entries(metadata)
    .map(([name, value]) => {
      const tagName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256);
      const tagValue = value.trim().slice(0, 256);
      if (!tagName || !tagValue) return null;
      return {
        Name: tagName,
        Value: tagValue,
      };
    })
    .filter((tag): tag is { Name: string; Value: string } => tag !== null)
    .slice(0, 10);

  return tags.length > 0 ? tags : undefined;
}

function toResendTags(metadata: Record<string, string> | undefined) {
  if (!metadata) return undefined;

  const tags = Object.entries(metadata)
    .map(([name, value]) => {
      const tagName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256);
      const tagValue = value
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 256);
      if (!tagName || !tagValue) return null;
      return {
        name: tagName,
        value: tagValue,
      };
    })
    .filter((tag): tag is { name: string; value: string } => tag !== null)
    .slice(0, 10);

  return tags.length > 0 ? tags : undefined;
}

function hasResendConfigurationHints(): boolean {
  return Boolean((process.env.RESEND_API_KEY || "").trim());
}

function hasSmtpConfigurationHints(): boolean {
  return Boolean(
    (process.env.VIVD_SMTP_URL || "").trim() ||
      (process.env.VIVD_SMTP_HOST || "").trim(),
  );
}

function hasSesConfigurationHints(): boolean {
  return Boolean(
    (process.env.VIVD_SES_FROM_EMAIL || "").trim() ||
      (process.env.VIVD_FROM_EMAIL || "").trim() ||
      ((process.env.VIVD_SES_ACCESS_KEY_ID || "").trim() &&
        (process.env.VIVD_SES_SECRET_ACCESS_KEY || "").trim()),
  );
}

function resolveEmailProvider(): string {
  const explicit =
    (process.env.VIVD_EMAIL_PROVIDER || process.env.EMAIL_PROVIDER || "")
      .trim()
      .toLowerCase();
  if (explicit) return explicit;
  if (hasResendConfigurationHints()) return "resend";
  if (hasSesConfigurationHints()) return "ses";
  if (hasSmtpConfigurationHints()) return "smtp";
  return "noop";
}

function resolveDefaultFromEmail(): string | null {
  return (
    (process.env.VIVD_EMAIL_FROM || "").trim() ||
    (process.env.VIVD_FROM_EMAIL || "").trim() ||
    (process.env.VIVD_SMTP_FROM_EMAIL || "").trim() ||
    (process.env.VIVD_SES_FROM_EMAIL || "").trim() ||
    null
  );
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveSesRegion(): string {
  const value =
    process.env.VIVD_SES_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "";
  return value.trim() || "us-east-1";
}

function resolveSesCredentials() {
  const accessKeyId = (process.env.VIVD_SES_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.VIVD_SES_SECRET_ACCESS_KEY || "").trim();
  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey };
}

function resolveSmtpTransport(): Transporter {
  const url = (process.env.VIVD_SMTP_URL || "").trim();
  if (url) {
    return nodemailer.createTransport(url);
  }

  const host = (process.env.VIVD_SMTP_HOST || "").trim();
  const portRaw = (process.env.VIVD_SMTP_PORT || "").trim();
  const parsedPort = Number.parseInt(portRaw || "", 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587;
  const secure = readBooleanEnv(process.env.VIVD_SMTP_SECURE, port === 465);
  const user = (process.env.VIVD_SMTP_USER || "").trim();
  const password = (process.env.VIVD_SMTP_PASSWORD || "").trim();
  const requireTls = readBooleanEnv(process.env.VIVD_SMTP_REQUIRE_TLS, false);
  const ignoreTls = readBooleanEnv(process.env.VIVD_SMTP_IGNORE_TLS, false);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: requireTls,
    ignoreTLS: ignoreTls,
    auth: user || password ? { user, pass: password } : undefined,
  });
}

function buildEmailServiceCacheKey(): string {
  return [
    process.env.VIVD_EMAIL_PROVIDER || "",
    process.env.EMAIL_PROVIDER || "",
    process.env.RESEND_API_KEY || "",
    process.env.VIVD_EMAIL_FROM || "",
    process.env.VIVD_FROM_EMAIL || "",
    process.env.VIVD_SMTP_URL || "",
    process.env.VIVD_SMTP_HOST || "",
    process.env.VIVD_SMTP_PORT || "",
    process.env.VIVD_SMTP_SECURE || "",
    process.env.VIVD_SMTP_USER || "",
    process.env.VIVD_SMTP_PASSWORD || "",
    process.env.VIVD_SMTP_REQUIRE_TLS || "",
    process.env.VIVD_SMTP_IGNORE_TLS || "",
    process.env.VIVD_SMTP_FROM_EMAIL || "",
    process.env.VIVD_SES_REGION || "",
    process.env.AWS_REGION || "",
    process.env.AWS_DEFAULT_REGION || "",
    process.env.VIVD_SES_ACCESS_KEY_ID || "",
    process.env.VIVD_SES_SECRET_ACCESS_KEY || "",
    process.env.VIVD_SES_FROM_EMAIL || "",
  ].join("|");
}

function createSesService(): EmailDeliveryService {
  const client = new SESv2Client({
    region: resolveSesRegion(),
    credentials: resolveSesCredentials(),
  });

  return new SesEmailDeliveryService(client, resolveDefaultFromEmail());
}

function createSmtpService(): EmailDeliveryService {
  const transporter = resolveSmtpTransport();
  return new SmtpEmailDeliveryService(transporter, resolveDefaultFromEmail());
}

function createResendService(): EmailDeliveryService {
  const apiKey = (process.env.RESEND_API_KEY || "").trim() || undefined;
  const client = new Resend(apiKey);
  return new ResendEmailDeliveryService(client, resolveDefaultFromEmail());
}

function createEmailService(): EmailDeliveryService {
  const provider = resolveEmailProvider();
  if (provider === "noop") return noopEmailDeliveryService;
  if (provider === "resend") return createResendService();
  if (provider === "ses") return createSesService();
  if (provider === "smtp") return createSmtpService();

  console.warn(
    `[EmailDeliveryService] Unsupported provider "${provider}". Falling back to noop.`,
  );
  return noopEmailDeliveryService;
}

export function getEmailDeliveryService(): EmailDeliveryService {
  const cacheKey = buildEmailServiceCacheKey();
  if (cachedEmailService && cachedEmailServiceKey === cacheKey) {
    return cachedEmailService;
  }

  cachedEmailService = createEmailService();
  cachedEmailServiceKey = cacheKey;
  return cachedEmailService;
}
