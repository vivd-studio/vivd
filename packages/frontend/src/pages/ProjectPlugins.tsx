import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";

type SnippetKind = "html" | "astro";
type ContactFormFieldType = "text" | "email" | "textarea";
type AnalyticsRange = 7 | 30;
type AnalyticsSummary = RouterOutputs["plugins"]["analyticsSummary"];

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

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatDeviceLabel(value: string): string {
  switch (value) {
    case "desktop":
      return "Desktop";
    case "mobile":
      return "Mobile";
    case "tablet":
      return "Tablet";
    case "bot":
      return "Bot";
    default:
      return "Unknown";
  }
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
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
          {snippet}
        </pre>
      </CardContent>
    </Card>
  );
}

function AnalyticsMetricCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
    </section>
  );
}

export default function ProjectPlugins() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const utils = trpc.useUtils();

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
  const [analyticsRangeDays, setAnalyticsRangeDays] = useState<AnalyticsRange>(30);

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
  const analyticsSummaryQuery = trpc.plugins.analyticsSummary.useQuery(
    { slug, rangeDays: analyticsRangeDays },
    { enabled: !!projectSlug && analyticsEnabled },
  );
  const analyticsSummary: AnalyticsSummary | undefined = analyticsSummaryQuery.data;
  const analyticsSnippets = analyticsInfo?.snippets ?? null;
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
    const refetches: Array<Promise<unknown>> = [
      catalogQuery.refetch(),
      contactInfoQuery.refetch(),
      analyticsInfoQuery.refetch(),
    ];
    if (analyticsEnabled) {
      refetches.push(analyticsSummaryQuery.refetch());
    }
    void Promise.all(refetches);
  };
  const analyticsRangeLabel = analyticsRangeDays === 7 ? "Last 7 days" : "Last 30 days";
  const analyticsMaxDailyEvents = analyticsSummary
    ? Math.max(1, ...analyticsSummary.daily.map((point) => point.events))
    : 1;

  if (!projectSlug) {
    return <div className="text-sm text-muted-foreground">Missing project slug.</div>;
  }
  const analyticsPath =
    ROUTES.PROJECT_ANALYTICS?.(projectSlug) ??
    `/vivd-studio/projects/${projectSlug}/analytics`;

  return (
    <SettingsPageShell
      title="Plugins"
      description={`Configure runtime plugins for ${projectSlug}.`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to={ROUTES.PROJECT(projectSlug)}>Back to project</Link>
          </Button>
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={
              catalogQuery.isLoading ||
              contactInfoQuery.isLoading ||
              analyticsInfoQuery.isLoading ||
              analyticsSummaryQuery.isLoading
            }
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      }
    >
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{contactCatalogEntry?.name || "Contact Form"}</CardTitle>
              <CardDescription>
                {contactCatalogEntry?.description ||
                  "Collect visitor inquiries and store submissions in Vivd."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={pluginEnabled ? "default" : "secondary"}>
                {pluginEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
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
              Contact Form access is managed in Super Admin → Plugins. Request
              flow is not available yet, so ask a super-admin to enable access
              for this project there, or write to support@vivd.studio.
            </div>
          ) : null}

          {pluginEnabled && contactInfo && recipientEmails.length === 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Contact Form is enabled, but no recipient email is configured yet.
            </div>
          ) : null}

          {pluginEnabled ? (
            <div className="space-y-6">
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="configuration">Configuration</TabsTrigger>
                  <TabsTrigger value="fields">Fields</TabsTrigger>
                  <TabsTrigger value="snippets">Snippets</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-6 max-w-4xl space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <SectionCard
                      title="Submit endpoint"
                      description="Public endpoint your form submits to."
                    >
                      <code className="text-xs break-all">
                        {contactInfo?.usage?.submitEndpoint || "Unavailable"}
                      </code>
                    </SectionCard>

                    <SectionCard
                      title="Public token"
                      description="Hidden form token identifying this plugin instance."
                    >
                      <code className="text-xs break-all">
                        {contactInfo?.publicToken || "Unavailable"}
                      </code>
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="Current behavior"
                    description="How host validation and redirects are resolved at runtime."
                  >
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      <li>
                        Source hosts are validated from the configured allowlist or
                        auto-detected first-party hosts.
                      </li>
                      <li>
                        Redirect hosts use configured redirect allowlist, then
                        effective source hosts as fallback.
                      </li>
                      <li>
                        Redirects are disabled when no effective hosts are available.
                      </li>
                    </ul>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="configuration" className="mt-6 max-w-4xl space-y-4">
                  <SectionCard
                    title="Recipient emails"
                    description="Only verified recipients receive contact form emails. Add from org emails or enter a custom address."
                  >
                    <div className="max-w-2xl space-y-4">
                      <div className="space-y-2">
                        <Label>Verified recipients (required)</Label>
                        {recipientEmails.length > 0 ? (
                          <div className="space-y-2">
                            {recipientEmails.map((email) => (
                              <div
                                key={email}
                                className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2"
                              >
                                <div className="flex items-center gap-2 text-sm">
                                  <code className="text-xs">{email}</code>
                                  <Badge variant="default">Verified</Badge>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRemoveRecipient(email)}
                                >
                                  <Trash2 className="mr-1 h-4 w-4" />
                                  Remove
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No verified recipients yet.
                          </p>
                        )}
                      </div>

                      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                        <Label>Add recipient</Label>
                        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                          <Select
                            value={selectedRecipientOption || undefined}
                            onValueChange={setSelectedRecipientOption}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select organization email" />
                            </SelectTrigger>
                            <SelectContent>
                              {recipientOptions.length > 0 ? (
                                recipientOptions.map((option) => (
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
                                ))
                              ) : (
                                <SelectItem value="__none" disabled>
                                  No organization emails available
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            onClick={handleAddSelectedRecipient}
                            disabled={requestRecipientVerificationMutation.isPending}
                          >
                            {requestRecipientVerificationMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Adding...
                              </>
                            ) : (
                              "Add"
                            )}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="contact-custom-recipient-email">
                            Or add custom email
                          </Label>
                          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                            <Input
                              id="contact-custom-recipient-email"
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
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Adding...
                                </>
                              ) : (
                                "Add custom"
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {pendingRecipients.length > 0 ? (
                        <div className="space-y-2">
                          <Label>Pending verifications</Label>
                          <div className="space-y-2">
                            {pendingRecipients.map((entry) => (
                              <div
                                key={entry.email}
                                className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2"
                              >
                                <div className="flex items-center gap-2 text-sm">
                                  <code className="text-xs">{entry.email}</code>
                                  <Badge variant="secondary">Pending</Badge>
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
                        </div>
                      ) : null}
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Allowed source hosts"
                    description="Optional. Leave empty to use auto mode based on first-party hosts."
                  >
                    <div className="space-y-3">
                      <div className="max-w-2xl space-y-2">
                        <Label htmlFor="contact-source-hosts">
                          Allowed source hosts (optional)
                        </Label>
                        <Textarea
                          id="contact-source-hosts"
                          value={sourceHostsInput}
                          onChange={(event) => setSourceHostsInput(event.target.value)}
                          placeholder={"mydomain.com\nwww.mydomain.com"}
                          rows={3}
                        />
                      </div>

                      <div className="max-w-2xl rounded-md border bg-muted/20 px-3 py-2">
                        <p className="mb-1 text-xs font-medium">
                          Auto-detected hosts (read-only fallback)
                        </p>
                        {inferredAutoSourceHosts.length > 0 ? (
                          <code className="text-xs whitespace-pre-wrap break-words">
                            {inferredAutoSourceHosts.join("\n")}
                          </code>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No inferred hosts yet (usually before first publish).
                          </p>
                        )}
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Allowed redirect hosts"
                    description="Optional. Used to validate `_redirect` host after successful submit."
                  >
                    <div className="max-w-2xl space-y-2">
                      <Label htmlFor="contact-redirect-hosts">
                        Allowed redirect hosts (optional)
                      </Label>
                      <Textarea
                        id="contact-redirect-hosts"
                        value={redirectHostsInput}
                        onChange={(event) => setRedirectHostsInput(event.target.value)}
                        placeholder="mydomain.com"
                        rows={3}
                      />
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="fields" className="mt-6 max-w-4xl space-y-4">
                  <SectionCard
                    title="Form fields"
                    description="Default fields are Name, Email, and Message. Customize labels, required status, and field types."
                    action={
                      <Button variant="outline" size="sm" onClick={addFormField}>
                        <Plus className="mr-1 h-4 w-4" />
                        Add field
                      </Button>
                    }
                  >
                    <div className="space-y-3">
                      {formFieldsInput.map((field, index) => (
                        <div
                          key={`form-field-${index}`}
                          className="rounded-lg border bg-card p-4 space-y-4"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">
                              Field {index + 1}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFormField(index)}
                              disabled={formFieldsInput.length <= 1}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              Remove
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor={`contact-field-key-${index}`}>Field key</Label>
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
                              <Label htmlFor={`contact-field-label-${index}`}>Label</Label>
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

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1">
                              <Label>Type</Label>
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
                              <Label htmlFor={`contact-field-placeholder-${index}`}>
                                Placeholder (optional)
                              </Label>
                              <Input
                                id={`contact-field-placeholder-${index}`}
                                value={field.placeholder}
                                onChange={(event) =>
                                  updateFormField(index, { placeholder: event.target.value })
                                }
                                placeholder="Optional placeholder"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`contact-field-rows-${index}`}>
                                Rows (textarea)
                              </Label>
                              <Input
                                id={`contact-field-rows-${index}`}
                                type="number"
                                min={2}
                                max={12}
                                disabled={field.type !== "textarea"}
                                value={field.type === "textarea" ? String(field.rows ?? 5) : ""}
                                onChange={(event) =>
                                  updateFormField(index, {
                                    rows:
                                      field.type === "textarea"
                                        ? Number(event.target.value || "5")
                                        : undefined,
                                  })
                                }
                              />
                            </div>
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
                              className="font-normal"
                            >
                              Required
                            </Label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </TabsContent>

                <TabsContent value="snippets" className="mt-6 max-w-4xl space-y-4">
                  <SectionCard
                    title="Embed snippets"
                    description="Insert one of these snippets into your site contact section."
                  >
                    {snippets ? (
                      <div className="grid gap-4 lg:grid-cols-2">
                        <SnippetCard
                          title="HTML snippet"
                          snippet={snippets.html}
                          onCopy={() => void handleCopy(snippets.html, "html")}
                        />
                        <SnippetCard
                          title="Astro snippet"
                          snippet={snippets.astro}
                          onCopy={() => void handleCopy(snippets.astro, "astro")}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Snippets are available after the plugin is enabled.
                      </p>
                    )}
                  </SectionCard>

                  {contactInfo?.instructions?.length ? (
                    <SectionCard
                      title="Implementation notes"
                      description="Runtime and validation details for production usage."
                    >
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {contactInfo.instructions.map((line, index) => (
                          <li key={`${index}-${line}`}>{line}</li>
                        ))}
                      </ul>
                    </SectionCard>
                  ) : null}
                </TabsContent>
              </Tabs>
              <div className="flex justify-end border-t pt-4">
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
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{analyticsCatalogEntry?.name || "Analytics"}</CardTitle>
              <CardDescription>
                {analyticsCatalogEntry?.description ||
                  "Website traffic analytics for pageviews, visitors, sessions, and sources."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {analyticsEnabled ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={analyticsPath}>
                    Open analytics dashboard
                  </Link>
                </Button>
              ) : null}
              <Badge variant={analyticsEnabled ? "default" : "secondary"}>
                {analyticsEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {analyticsInfoQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load Analytics plugin info: {analyticsInfoQuery.error.message}
            </div>
          ) : null}
          {analyticsEnabled && analyticsSummaryQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Failed to load Analytics dashboard data: {analyticsSummaryQuery.error.message}
            </div>
          ) : null}

          {!analyticsEnabled ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Analytics access is managed in Super Admin → Plugins. Ask a super-admin
              to enable Analytics for this project. Once enabled, dashboard stats
              appear here automatically.
            </div>
          ) : null}

          {analyticsEnabled ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {analyticsSummary
                    ? `${analyticsRangeLabel}: ${analyticsSummary.rangeStart} to ${analyticsSummary.rangeEnd}`
                    : `${analyticsRangeLabel}`}
                </p>
                <div className="inline-flex rounded-md border p-0.5">
                  <Button
                    size="sm"
                    variant={analyticsRangeDays === 7 ? "default" : "ghost"}
                    onClick={() => setAnalyticsRangeDays(7)}
                    disabled={analyticsSummaryQuery.isFetching}
                  >
                    7 days
                  </Button>
                  <Button
                    size="sm"
                    variant={analyticsRangeDays === 30 ? "default" : "ghost"}
                    onClick={() => setAnalyticsRangeDays(30)}
                    disabled={analyticsSummaryQuery.isFetching}
                  >
                    30 days
                  </Button>
                </div>
              </div>

              {analyticsSummaryQuery.isLoading ? (
                <div className="rounded-md border bg-muted/20 px-3 py-8">
                  <LoadingSpinner message="Loading analytics dashboard..." />
                </div>
              ) : analyticsSummary ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    <AnalyticsMetricCard
                      label="Pageviews"
                      value={formatInteger(analyticsSummary.totals.pageviews)}
                    />
                    <AnalyticsMetricCard
                      label="Unique visitors"
                      value={formatInteger(analyticsSummary.totals.uniqueVisitors)}
                    />
                    <AnalyticsMetricCard
                      label="Sessions"
                      value={formatInteger(analyticsSummary.totals.uniqueSessions)}
                    />
                    <AnalyticsMetricCard
                      label="Total events"
                      value={formatInteger(analyticsSummary.totals.events)}
                    />
                    <AnalyticsMetricCard
                      label="Avg pages / session"
                      value={formatRatio(analyticsSummary.totals.avgPagesPerSession)}
                    />
                  </div>

                  <SectionCard
                    title="Daily traffic trend"
                    description="Events per day in the selected range."
                  >
                    <div className="space-y-2">
                      {analyticsSummary.daily.map((point) => (
                        <div key={point.date} className="grid grid-cols-[72px_1fr_96px] items-center gap-3">
                          <span className="text-xs text-muted-foreground">{point.date.slice(5)}</span>
                          <Progress
                            value={Math.round((point.events / analyticsMaxDailyEvents) * 100)}
                          />
                          <span className="text-right text-xs text-muted-foreground">
                            {formatInteger(point.events)} events
                          </span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <SectionCard title="Top pages" description="Most visited page paths.">
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Path</th>
                              <th className="px-3 py-2 font-medium">Pageviews</th>
                              <th className="px-3 py-2 font-medium">Visitors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.topPages.length > 0 ? (
                              analyticsSummary.topPages.map((row) => (
                                <tr key={row.path} className="border-t">
                                  <td className="px-3 py-2 text-xs break-all">{row.path}</td>
                                  <td className="px-3 py-2">{formatInteger(row.pageviews)}</td>
                                  <td className="px-3 py-2">{formatInteger(row.uniqueVisitors)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-sm text-muted-foreground" colSpan={3}>
                                  No pageviews collected in this range yet.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Top referrers"
                      description="External hosts sending traffic to your site."
                    >
                      <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/30">
                            <tr className="text-left">
                              <th className="px-3 py-2 font-medium">Referrer host</th>
                              <th className="px-3 py-2 font-medium">Events</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsSummary.topReferrers.length > 0 ? (
                              analyticsSummary.topReferrers.map((row) => (
                                <tr key={row.referrerHost} className="border-t">
                                  <td className="px-3 py-2 text-xs break-all">
                                    {row.referrerHost}
                                  </td>
                                  <td className="px-3 py-2">{formatInteger(row.events)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr className="border-t">
                                <td className="px-3 py-3 text-sm text-muted-foreground" colSpan={2}>
                                  No referrer data yet. Direct and untracked visits are common early on.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="Device split"
                    description="Share of events by visitor device type."
                  >
                    {analyticsSummary.devices.length > 0 ? (
                      <div className="space-y-3">
                        {analyticsSummary.devices.map((row) => (
                          <div key={row.deviceType} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {formatDeviceLabel(row.deviceType)}
                              </span>
                              <span>
                                {formatInteger(row.events)} events ({formatPercent(row.share)})
                              </span>
                            </div>
                            <Progress value={Math.min(100, Math.max(0, row.share))} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No device data collected in this range yet.
                      </p>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Install details"
                    description="Snippet and runtime notes for analytics tracking."
                  >
                    {analyticsSnippets ? (
                      <div className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <SnippetCard
                            title="HTML snippet"
                            snippet={analyticsSnippets.html}
                            onCopy={() => void handleCopy(analyticsSnippets.html, "html")}
                          />
                          <SnippetCard
                            title="Astro snippet"
                            snippet={analyticsSnippets.astro}
                            onCopy={() => void handleCopy(analyticsSnippets.astro, "astro")}
                          />
                        </div>
                        {analyticsInfo.instructions.length > 0 ? (
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {analyticsInfo.instructions.map((line, index) => (
                              <li key={`${index}-${line}`}>{line}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Snippets are available after analytics is enabled.
                      </p>
                    )}
                  </SectionCard>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
}
