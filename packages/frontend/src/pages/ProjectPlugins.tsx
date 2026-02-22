import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";
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

export default function ProjectPlugins() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const utils = trpc.useUtils();
  const { isSuperAdmin } = usePermissions();

  const slug = projectSlug || "";
  const catalogQuery = trpc.plugins.catalog.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );
  const contactInfoQuery = trpc.plugins.contactInfo.useQuery(
    { slug },
    { enabled: !!projectSlug },
  );

  const ensureContactMutation = trpc.plugins.contactEnsure.useMutation({
    onSuccess: async () => {
      toast.success("Contact Form plugin enabled");
      await Promise.all([
        utils.plugins.catalog.invalidate({ slug }),
        utils.plugins.contactInfo.invalidate({ slug }),
      ]);
    },
    onError: (error) => {
      toast.error("Failed to enable Contact Form plugin", {
        description: error.message,
      });
    },
  });

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

  const contactCatalogEntry = useMemo(
    () =>
      catalogQuery.data?.available.find((plugin) => plugin.pluginId === "contact_form"),
    [catalogQuery.data?.available],
  );

  const contactInfo = contactInfoQuery.data;
  const pluginEnabled = !!contactInfo?.enabled;
  const snippets = contactInfo?.snippets;
  const inferredAutoSourceHosts = contactInfo?.usage?.inferredAutoSourceHosts || [];
  const [recipientEmailsInput, setRecipientEmailsInput] = useState("");
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");
  const [formFieldsInput, setFormFieldsInput] = useState<EditableContactFormField[]>(
    DEFAULT_CONTACT_FORM_FIELDS,
  );

  useEffect(() => {
    if (!contactInfo?.config) return;
    setRecipientEmailsInput(formatListInput(contactInfo.config.recipientEmails));
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

    const recipientEmails = parseListInput(recipientEmailsInput);
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

  if (!projectSlug) {
    return <div className="text-sm text-muted-foreground">Missing project slug.</div>;
  }

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
            onClick={() => {
              void Promise.all([catalogQuery.refetch(), contactInfoQuery.refetch()]);
            }}
            disabled={catalogQuery.isLoading || contactInfoQuery.isLoading}
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
              {!pluginEnabled && isSuperAdmin ? (
                <Button
                  onClick={() => ensureContactMutation.mutate({ slug })}
                  disabled={
                    ensureContactMutation.isPending ||
                    catalogQuery.isLoading ||
                    contactInfoQuery.isLoading
                  }
                >
                  {ensureContactMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enabling...
                    </>
                  ) : (
                    "Enable Contact Form"
                  )}
                </Button>
              ) : null}
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

          {!pluginEnabled && !isSuperAdmin ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Only super-admin users can enable plugins. Ask a super-admin to
              enable Contact Form for this project.
            </div>
          ) : null}

          {pluginEnabled && (contactInfo?.config?.recipientEmails?.length || 0) === 0 ? (
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
                    description="Required. One email per line (comma-separated also supported)."
                  >
                    <div className="max-w-2xl space-y-2">
                      <Label htmlFor="contact-recipient-emails">
                        Recipient emails (required)
                      </Label>
                      <Textarea
                        id="contact-recipient-emails"
                        value={recipientEmailsInput}
                        onChange={(event) => setRecipientEmailsInput(event.target.value)}
                        placeholder="team@example.com"
                        rows={4}
                      />
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
    </SettingsPageShell>
  );
}
