import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ChevronDown,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPageShell, FormContent } from "@/components/settings/SettingsPageShell";
import { useAppConfig } from "@/lib/AppConfigContext";
import { formatDocumentTitle } from "@/lib/brand";

type SnippetKind = "html" | "astro";
type ContactFormFieldType = "text" | "email" | "textarea";

type EditableContactFormField = {
  key: string;
  label: string;
  type: ContactFormFieldType;
  required: boolean;
  placeholder: string;
  rows?: number;
};

const DEFAULT_CONTACT_FORM_FIELDS: EditableContactFormField[] = [
  {
    key: "name",
    label: "Name",
    type: "text",
    required: true,
    placeholder: "",
  },
  {
    key: "email",
    label: "Email",
    type: "email",
    required: true,
    placeholder: "",
  },
  {
    key: "message",
    label: "Message",
    type: "textarea",
    required: true,
    placeholder: "",
    rows: 5,
  },
];

const CONTACT_FORM_RESERVED_FIELD_KEYS = new Set([
  "token",
  "_honeypot",
  "_redirect",
  "_subject",
  "cf-turnstile-response",
]);

function parseListInput(value: string): string[] {
  const parts = value
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(parts));
}

function formatListInput(values: string[]): string {
  return values.join("\n");
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left group">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <div className="border-t px-4 pb-4 pt-3 space-y-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SnippetCard({
  title,
  snippet,
  onCopy,
}: {
  title: string;
  snippet: string;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
        {snippet}
      </pre>
    </div>
  );
}

export default function ProjectPlugins() {
  const { config } = useAppConfig();
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const utils = trpc.useUtils();
  const isEmbedded = useMemo(
    () => new URLSearchParams(location.search).get("embedded") === "1",
    [location.search],
  );

  const slug = projectSlug || "";
  const catalogQuery = trpc.plugins.catalog.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );
  const contactInfoQuery = trpc.plugins.contactInfo.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );
  const analyticsInfoQuery = trpc.plugins.analyticsInfo.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );
  const projectListQuery = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const projectTitle =
    projectListQuery.data?.projects?.find((project) => project.slug === slug)?.title ?? slug;

  useEffect(() => {
    if (!projectSlug) return;
    document.title = formatDocumentTitle(`${projectTitle} Plugins`);
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [projectSlug, projectTitle]);

  const updateContactConfigMutation = trpc.plugins.contactUpdateConfig.useMutation({
    onSuccess: async () => {
      toast.success("Contact Form configuration saved");
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug }),
        utils.plugins.contactInfo.invalidate({ slug }),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to save Contact Form configuration", {
        description: error.message,
      });
    },
  });
  const requestRecipientVerificationMutation =
    trpc.plugins.contactRequestRecipientVerification.useMutation({
      onSuccess: async (result) => {
        if (result.status === "added_verified" || result.status === "already_verified") {
          toast.success("Recipient verified");
        } else if (result.status === "verification_sent") {
          toast.success("Verification email sent");
        } else {
          toast.success("Recipient already pending verification", {
            description:
              result.cooldownRemainingSeconds > 0
                ? `Try resend in about ${result.cooldownRemainingSeconds}s.`
                : undefined,
          });
        }

        setSelectedRecipientOption("");
        setCustomRecipientEmail("");
        await Promise.all([
          utils.plugins.catalog.invalidate({ slug }),
          utils.plugins.contactInfo.invalidate({ slug }),
        ]);
      },
      onError: (error) => {
        toast.error("Failed to add recipient", {
          description: error.message,
        });
      },
    });

  const contactCatalogEntry = useMemo(
    () =>
      catalogQuery.data?.available.find((plugin) => plugin.pluginId === "contact_form"),
    [catalogQuery.data?.available],
  );
  const analyticsCatalogEntry = useMemo(
    () => catalogQuery.data?.available.find((plugin) => plugin.pluginId === "analytics"),
    [catalogQuery.data?.available],
  );

  const contactInfo = contactInfoQuery.data;
  const analyticsInfo = analyticsInfoQuery.data;
  const analyticsEnabled = !!analyticsInfo?.enabled;
  const pluginEnabled = !!contactInfo?.enabled;
  const snippets = contactInfo?.snippets;
  const inferredAutoSourceHosts = contactInfo?.usage?.inferredAutoSourceHosts || [];
  const recipientDirectory = contactInfo?.recipients;
  const recipientOptions = recipientDirectory?.options ?? [];
  const pendingRecipients = recipientDirectory?.pending ?? [];
  const [recipientEmails, setRecipientEmails] = useState<string[]>([]);
  const [selectedRecipientOption, setSelectedRecipientOption] = useState("");
  const [customRecipientEmail, setCustomRecipientEmail] = useState("");
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");
  const [formFieldsInput, setFormFieldsInput] = useState<EditableContactFormField[]>(
    DEFAULT_CONTACT_FORM_FIELDS,
  );

  useEffect(() => {
    if (!contactInfo?.config) return;
    setRecipientEmails(contactInfo.config.recipientEmails.map(normalizeEmailAddress));
    setSourceHostsInput(formatListInput(contactInfo.config.sourceHosts));
    setRedirectHostsInput(formatListInput(contactInfo.config.redirectHostAllowlist));
    setFormFieldsInput(
      (contactInfo.config.formFields || DEFAULT_CONTACT_FORM_FIELDS).map((field) => ({
        key: field.key || "",
        label: field.label || "",
        type: field.type || "text",
        required: field.required ?? true,
        placeholder: field.placeholder || "",
        rows: field.type === "textarea" ? (field.rows ?? 5) : undefined,
      })),
    );
  }, [
    contactInfo?.instanceId,
    contactInfo?.config?.recipientEmails,
    contactInfo?.config?.sourceHosts,
    contactInfo?.config?.redirectHostAllowlist,
    contactInfo?.config?.formFields,
  ]);

  const handleCopy = async (value: string, kind: SnippetKind) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${kind.toUpperCase()} snippet copied`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to copy snippet", { description: message });
    }
  };

  const updateFormField = (index: number, patch: Partial<EditableContactFormField>) => {
    setFormFieldsInput((previous) =>
      previous.map((field, currentIndex) =>
        currentIndex === index ? { ...field, ...patch } : field,
      ),
    );
  };

  const addFormField = () => {
    setFormFieldsInput((previous) => [
      ...previous,
      {
        key: `field_${previous.length + 1}`,
        label: "New Field",
        type: "text",
        required: false,
        placeholder: "",
      },
    ]);
  };

  const removeFormField = (index: number) => {
    setFormFieldsInput((previous) => {
      if (previous.length <= 1) return previous;
      return previous.filter((_, currentIndex) => currentIndex !== index);
    });
  };

  const handleSaveConfig = () => {
    if (!pluginEnabled) return;

    if (recipientEmails.length === 0) {
      toast.error("Add at least one recipient email");
      return;
    }

    if (formFieldsInput.length === 0) {
      toast.error("Add at least one form field");
      return;
    }

    const normalizedFormFields = formFieldsInput.map((field) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      type: field.type,
      required: field.required,
      placeholder: field.placeholder.trim(),
      rows:
        field.type === "textarea"
          ? Math.max(2, Math.min(12, Number(field.rows || 5)))
          : undefined,
    }));

    const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    const seenKeys = new Set<string>();
    for (const field of normalizedFormFields) {
      if (!field.key || !field.label) {
        toast.error("Each form field needs a key and label");
        return;
      }

      if (!keyPattern.test(field.key)) {
        toast.error(
          `Field key "${field.key}" is invalid (use letters, numbers, "_" or "-", starting with a letter)`,
        );
        return;
      }

      const normalizedKey = field.key.toLowerCase();
      if (CONTACT_FORM_RESERVED_FIELD_KEYS.has(normalizedKey)) {
        toast.error(`Field key "${field.key}" is reserved and cannot be used`);
        return;
      }

      if (seenKeys.has(normalizedKey)) {
        toast.error(`Duplicate field key "${field.key}"`);
        return;
      }
      seenKeys.add(normalizedKey);
    }

    updateContactConfigMutation.mutate({
      slug,
      config: {
        recipientEmails,
        sourceHosts: parseListInput(sourceHostsInput),
        redirectHostAllowlist: parseListInput(redirectHostsInput),
        formFields: normalizedFormFields,
      },
    });
  };

  const handleRequestRecipientVerification = (email: string) => {
    if (!pluginEnabled) return;
    const normalizedEmail = normalizeEmailAddress(email);
    if (!normalizedEmail) {
      toast.error("Select an email first");
      return;
    }

    requestRecipientVerificationMutation.mutate({
      slug,
      email: normalizedEmail,
    });
  };

  const handleAddSelectedRecipient = () => {
    const candidate = normalizeEmailAddress(selectedRecipientOption);
    if (!candidate) {
      toast.error("Select an email first");
      return;
    }
    handleRequestRecipientVerification(candidate);
  };

  const handleAddCustomRecipient = () => {
    const candidate = normalizeEmailAddress(customRecipientEmail);
    if (!candidate) {
      toast.error("Enter a custom email first");
      return;
    }
    handleRequestRecipientVerification(candidate);
  };

  const handleRemoveRecipient = (email: string) => {
    const normalizedEmail = normalizeEmailAddress(email);
    setRecipientEmails((previous) =>
      previous.filter((entry) => normalizeEmailAddress(entry) !== normalizedEmail),
    );
  };

  const handleRefresh = () => {
    void Promise.all([
      catalogQuery.refetch(),
      contactInfoQuery.refetch(),
      analyticsInfoQuery.refetch(),
    ]);
  };

  if (!projectSlug) {
    return <div className="text-sm text-muted-foreground">Missing project slug.</div>;
  }
  const analyticsPath =
    ROUTES.PROJECT_ANALYTICS?.(projectSlug) ??
    `/vivd-studio/projects/${projectSlug}/analytics`;
  const analyticsLink = isEmbedded ? `${analyticsPath}?embedded=1` : analyticsPath;
  const contactDisabledCopy =
    config.installProfile === "solo"
      ? "Contact Form is disabled for this instance. Open Instance Settings -> Plugins to enable it."
      : "Contact Form access is managed in Super Admin. Ask a super-admin to enable access for this project.";
  const analyticsDisabledCopy =
    config.installProfile === "solo"
      ? "Analytics is disabled for this instance. Open Instance Settings -> Plugins to enable it."
      : "Analytics access is managed in Super Admin. Ask a super-admin to enable Analytics for this project.";

  return (
    <SettingsPageShell
      title="Plugins"
      description={`Configure runtime plugins for ${projectSlug}.`}
      className={isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined}
      actions={
        <div className="flex items-center gap-2">
          {!isEmbedded ? (
            <Button variant="outline" asChild>
              <Link to={ROUTES.PROJECT(projectSlug)}>Back to project</Link>
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={
              catalogQuery.isLoading ||
              contactInfoQuery.isLoading ||
              analyticsInfoQuery.isLoading
            }
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <FormContent className={isEmbedded ? "mx-auto max-w-3xl" : "max-w-3xl"}>
      {/* ── Contact Form ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{contactCatalogEntry?.name || "Contact Form"}</CardTitle>
              <CardDescription>
                {contactCatalogEntry?.description ||
                  "Collect visitor inquiries and store submissions in Vivd."}
              </CardDescription>
            </div>
            <Badge variant={pluginEnabled ? "default" : "secondary"}>
              {pluginEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {catalogQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load plugin catalog: {catalogQuery.error.message}
            </div>
          ) : null}
          {contactInfoQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load Contact Form plugin info: {contactInfoQuery.error.message}
            </div>
          ) : null}

          {!pluginEnabled ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {contactDisabledCopy}
            </div>
          ) : null}

          {pluginEnabled ? (
            <>
              {/* ── Recipients (primary section) ── */}
              <SectionCard
                title="Recipients"
                description="Who receives contact form submissions. Only verified email addresses will get notifications."
              >
                <div className="space-y-4">
                  {recipientEmails.length > 0 ? (
                    <div className="space-y-2">
                      {recipientEmails.map((email) => (
                        <div
                          key={email}
                          className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <span>{email}</span>
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                              Verified
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveRecipient(email)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                      Add an email address to start receiving form submissions.
                    </div>
                  )}

                  {pendingRecipients.length > 0 ? (
                    <div className="space-y-2">
                      {pendingRecipients.map((entry) => (
                        <div
                          key={entry.email}
                          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2"
                        >
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{entry.email}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              Pending
                            </Badge>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleRequestRecipientVerification(entry.email)}
                            disabled={requestRecipientVerificationMutation.isPending}
                          >
                            Resend
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Add recipient
                    </Label>
                    {recipientOptions.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <Select
                          value={selectedRecipientOption || undefined}
                          onValueChange={setSelectedRecipientOption}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select organization email" />
                          </SelectTrigger>
                          <SelectContent>
                            {recipientOptions.map((option) => (
                              <SelectItem
                                key={option.email}
                                value={option.email}
                                disabled={option.isVerified || option.isPending}
                              >
                                {option.email}
                                {option.isVerified
                                  ? " (Verified)"
                                  : option.isPending
                                    ? " (Pending)"
                                    : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          onClick={handleAddSelectedRecipient}
                          disabled={requestRecipientVerificationMutation.isPending}
                        >
                          {requestRecipientVerificationMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Add"
                          )}
                        </Button>
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Input
                        value={customRecipientEmail}
                        onChange={(event) =>
                          setCustomRecipientEmail(event.target.value)
                        }
                        placeholder="team@example.com"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddCustomRecipient}
                        disabled={requestRecipientVerificationMutation.isPending}
                      >
                        {requestRecipientVerificationMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Add"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* ── Form Fields (collapsible) ── */}
              <CollapsibleSection
                title="Form Fields"
                description="Customize which fields appear on your contact form."
              >
                <div className="space-y-3">
                  {formFieldsInput.map((field, index) => (
                    <div
                      key={`form-field-${index}`}
                      className="rounded-lg border bg-card p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {field.label || `Field ${index + 1}`}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFormField(index)}
                          disabled={formFieldsInput.length <= 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`contact-field-key-${index}`} className="text-xs">
                            Field key
                          </Label>
                          <Input
                            id={`contact-field-key-${index}`}
                            value={field.key}
                            onChange={(event) =>
                              updateFormField(index, { key: event.target.value })
                            }
                            placeholder="name"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`contact-field-label-${index}`} className="text-xs">
                            Label
                          </Label>
                          <Input
                            id={`contact-field-label-${index}`}
                            value={field.label}
                            onChange={(event) =>
                              updateFormField(index, { label: event.target.value })
                            }
                            placeholder="Name"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Type</Label>
                          <Select
                            value={field.type}
                            onValueChange={(value) =>
                              updateFormField(index, {
                                type: value as ContactFormFieldType,
                                rows: value === "textarea" ? field.rows ?? 5 : undefined,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Text</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="textarea">Textarea</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`contact-field-placeholder-${index}`} className="text-xs">
                            Placeholder
                          </Label>
                          <Input
                            id={`contact-field-placeholder-${index}`}
                            value={field.placeholder}
                            onChange={(event) =>
                              updateFormField(index, { placeholder: event.target.value })
                            }
                            placeholder="Optional"
                          />
                        </div>
                        {field.type === "textarea" ? (
                          <div className="space-y-1">
                            <Label htmlFor={`contact-field-rows-${index}`} className="text-xs">
                              Rows
                            </Label>
                            <Input
                              id={`contact-field-rows-${index}`}
                              type="number"
                              min={2}
                              max={12}
                              value={String(field.rows ?? 5)}
                              onChange={(event) =>
                                updateFormField(index, {
                                  rows: Number(event.target.value || "5"),
                                })
                              }
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`contact-field-required-${index}`}
                          checked={field.required}
                          onCheckedChange={(checked) =>
                            updateFormField(index, { required: checked === true })
                          }
                        />
                        <Label
                          htmlFor={`contact-field-required-${index}`}
                          className="font-normal text-xs"
                        >
                          Required
                        </Label>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addFormField}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add field
                  </Button>
                </div>
              </CollapsibleSection>

              {/* ── Advanced: Host Allowlists (collapsible) ── */}
              <CollapsibleSection
                title="Advanced Settings"
                description="Source hosts, redirect allowlists, and other security settings."
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="contact-source-hosts" className="text-xs font-medium">
                      Allowed source hosts
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to automatically use your project's domains.
                    </p>
                    <Textarea
                      id="contact-source-hosts"
                      value={sourceHostsInput}
                      onChange={(event) => setSourceHostsInput(event.target.value)}
                      placeholder={"mydomain.com\nwww.mydomain.com"}
                      rows={3}
                    />
                    {inferredAutoSourceHosts.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Auto-detected: {inferredAutoSourceHosts.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contact-redirect-hosts" className="text-xs font-medium">
                      Allowed redirect hosts
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Validates the redirect URL after successful form submission.
                    </p>
                    <Textarea
                      id="contact-redirect-hosts"
                      value={redirectHostsInput}
                      onChange={(event) => setRedirectHostsInput(event.target.value)}
                      placeholder="mydomain.com"
                      rows={3}
                    />
                  </div>
                </div>
              </CollapsibleSection>

              {/* ── Embed Snippets (collapsible) ── */}
              <CollapsibleSection
                title="Embed Snippets"
                description="Copy a snippet to add the contact form to your website."
              >
                {snippets ? (
                  <div className="space-y-4">
                    <SnippetCard
                      title="HTML"
                      snippet={snippets.html}
                      onCopy={() => void handleCopy(snippets.html, "html")}
                    />
                    <SnippetCard
                      title="Astro"
                      snippet={snippets.astro}
                      onCopy={() => void handleCopy(snippets.astro, "astro")}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Snippets are available after the plugin is enabled.
                  </p>
                )}
              </CollapsibleSection>

              {/* ── Save ── */}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveConfig}
                  disabled={updateContactConfigMutation.isPending}
                >
                  {updateContactConfigMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save configuration"
                  )}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Analytics ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{analyticsCatalogEntry?.name || "Analytics"}</CardTitle>
              <CardDescription>
                {analyticsCatalogEntry?.description ||
                  "Track page traffic and visitor behavior for your project."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {analyticsEnabled ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={analyticsLink}>Open dashboard</Link>
                </Button>
              ) : null}
              <Badge variant={analyticsEnabled ? "default" : "secondary"}>
                {analyticsEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {analyticsInfoQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load Analytics plugin info: {analyticsInfoQuery.error.message}
            </div>
          ) : null}

          {!analyticsEnabled ? (
            <p className="text-sm text-muted-foreground">
              {analyticsDisabledCopy}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Analytics reporting is available on the dedicated Analytics page.
            </p>
          )}
        </CardContent>
      </Card>
      </FormContent>
    </SettingsPageShell>
  );
}
