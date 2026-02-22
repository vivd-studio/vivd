import { z } from "zod";

const CONTACT_FORM_RESERVED_FIELD_KEYS = new Set([
  "token",
  "_honeypot",
  "_redirect",
  "_subject",
  "cf-turnstile-response",
]);

export const contactFormFieldTypeSchema = z.enum(["text", "email", "textarea"]);
export type ContactFormFieldType = z.infer<typeof contactFormFieldTypeSchema>;

export const DEFAULT_CONTACT_FORM_FIELDS = [
  {
    key: "name",
    label: "Name",
    type: "text" as const,
    required: true,
    placeholder: "",
  },
  {
    key: "email",
    label: "Email",
    type: "email" as const,
    required: true,
    placeholder: "",
  },
  {
    key: "message",
    label: "Message",
    type: "textarea" as const,
    required: true,
    placeholder: "",
    rows: 5,
  },
];

export const contactFormFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  label: z.string().trim().min(1).max(80),
  type: contactFormFieldTypeSchema,
  required: z.boolean().default(true),
  placeholder: z.string().trim().max(120).default(""),
  rows: z.number().int().min(2).max(12).optional(),
});
export type ContactFormFieldConfig = z.infer<typeof contactFormFieldSchema>;

export const contactFormPluginConfigSchema = z.object({
  recipientEmails: z.array(z.string().email()).default([]),
  sourceHosts: z.array(z.string().min(1)).default([]),
  redirectHostAllowlist: z.array(z.string().min(1)).default([]),
  formFields: z
    .array(contactFormFieldSchema)
    .min(1)
    .max(12)
    .default(DEFAULT_CONTACT_FORM_FIELDS),
}).superRefine((config, ctx) => {
  const seen = new Set<string>();

  for (const [index, field] of config.formFields.entries()) {
    const normalizedKey = field.key.trim().toLowerCase();
    if (CONTACT_FORM_RESERVED_FIELD_KEYS.has(normalizedKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formFields", index, "key"],
        message: `"${field.key}" is reserved and cannot be used as a form field key`,
      });
    }

    if (seen.has(normalizedKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formFields", index, "key"],
        message: `Duplicate field key "${field.key}"`,
      });
    }
    seen.add(normalizedKey);
  }
});

export type ContactFormPluginConfig = z.infer<typeof contactFormPluginConfigSchema>;
