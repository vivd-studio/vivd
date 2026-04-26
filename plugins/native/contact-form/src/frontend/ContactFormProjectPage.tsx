import { type ReactNode, useEffect, useState } from "react";
import { ChevronDown, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Panel,
  PanelContent,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Textarea,
} from "@vivd/ui";
import { FormContent, SettingsPageShell } from "@/plugins/host";
import { trpc, type RouterOutputs } from "@/plugins/host";
import {
  ProjectPluginAccessActions,
  ProjectPluginPageActions,
  useProjectPluginPageModel,
} from "@/plugins/host";

type ContactFormFieldType = "text" | "email" | "textarea";

type ContactFormProjectPageProps = {
  projectSlug: string;
  isEmbedded?: boolean;
};

type EditableContactFormField = {
  key: string;
  label: string;
  type: ContactFormFieldType;
  required: boolean;
  placeholder: string;
  rows?: number;
};

type ContactFormConfig = {
  recipientEmails: string[];
  sourceHosts: string[];
  redirectHostAllowlist: string[];
  formFields?: EditableContactFormField[];
};

type ContactRecipientDirectory = {
  options: Array<{
    email: string;
    isVerified: boolean;
    isPending: boolean;
  }>;
  pending: Array<{
    email: string;
  }>;
};

type ContactFormUsage = {
  configuredSourceHosts?: string[];
  inferredAutoSourceHosts: string[];
  effectiveSourceHosts?: string[];
  turnstileExpectedDomains?: string[];
  turnstileEnabled?: boolean;
};

type ContactFormSnippets = {
  html: string;
  astro: string;
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
    <Panel tone="sunken">
      <PanelHeader className="flex-row items-start justify-between gap-3 p-4">
        <div>
          <PanelTitle className="text-sm">{title}</PanelTitle>
          {description ? (
            <PanelDescription className="mt-1 text-xs">
              {description}
            </PanelDescription>
          ) : null}
        </div>
        {action}
      </PanelHeader>
      <PanelContent className="space-y-3 p-4 pt-0">{children}</PanelContent>
    </Panel>
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
    <Collapsible defaultOpen={defaultOpen} className="overflow-hidden">
      <Panel tone="sunken">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 p-4 text-left">
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <div className="space-y-4 border-t px-4 pb-4 pt-3">{children}</div>
        </CollapsibleContent>
      </Panel>
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
      <Panel tone="sunken" className="max-h-64 overflow-auto p-3">
        <pre className="text-xs whitespace-pre-wrap break-words">{snippet}</pre>
      </Panel>
    </div>
  );
}

function getContactFormInfo(
  value: RouterOutputs["plugins"]["info"] | undefined,
):
  | (RouterOutputs["plugins"]["info"] & {
      config: ContactFormConfig | null;
      usage: ContactFormUsage | null;
      snippets: ContactFormSnippets | null;
      details: {
        recipients?: ContactRecipientDirectory;
      } | null;
    })
  | null {
  return (value ?? null) as any;
}

export default function ContactFormProjectPage({
  projectSlug,
  isEmbedded = false,
}: ContactFormProjectPageProps) {
  const {
    typedPluginId,
    pluginInfoQuery: infoQuery,
    pluginEnabled,
    needsEnable: contactNeedsProjectEnable,
    pluginPresentation,
    PluginIcon,
    canEnablePlugin: canManageProjectPlugins,
    canRequestPluginAccess,
    isRequestPending,
    requestAccessLabel,
    disabledCopy,
    ensureMutation,
    requestAccessMutation,
    invalidatePluginPage,
    refreshPluginPage,
  } = useProjectPluginPageModel({
    projectSlug,
    pluginId: "contact_form",
    isEmbedded,
    documentTitle: ({ projectTitle }) => `${projectTitle} Contact Form`,
    enableToast: {
      success: "Contact Form enabled for this project",
      error: "Failed to enable Contact Form",
    },
    requestAccessToast: {
      success: "Access request sent",
      error: "Failed to send access request",
    },
  });
  const updateConfigMutation = trpc.plugins.updateConfig.useMutation({
    onSuccess: async () => {
      toast.success("Contact Form configuration saved");
      await invalidateContactFormPage();
    },
    onError: (error) => {
      toast.error("Failed to save Contact Form configuration", {
        description: error.message,
      });
    },
  });
  const actionMutation = trpc.plugins.action.useMutation({
    onSuccess: async (result) => {
      const requestResult = result.result as {
        status?: string;
        cooldownRemainingSeconds?: number;
      };
      if (
        requestResult.status === "added_verified" ||
        requestResult.status === "already_verified"
      ) {
        toast.success("Recipient verified");
      } else if (requestResult.status === "verification_sent") {
        toast.success("Verification email sent");
      } else {
        toast.success("Recipient already pending verification", {
          description:
            requestResult.cooldownRemainingSeconds &&
            requestResult.cooldownRemainingSeconds > 0
              ? `Try resend in about ${requestResult.cooldownRemainingSeconds}s.`
              : undefined,
        });
      }

      setSelectedRecipientOption("");
      setCustomRecipientEmail("");
      await invalidateContactFormPage();
    },
    onError: (error) => {
      toast.error("Failed to update recipient verification", {
        description: error.message,
      });
    },
  });

  const pluginInfo = getContactFormInfo(infoQuery.data);
  const snippets = pluginInfo?.snippets;
  const inferredAutoSourceHosts =
    pluginInfo?.usage?.inferredAutoSourceHosts || [];
  const effectiveSourceHosts = pluginInfo?.usage?.effectiveSourceHosts || [];
  const turnstileExpectedDomains =
    pluginInfo?.usage?.turnstileExpectedDomains || [];
  const recipientDirectory = pluginInfo?.details?.recipients;
  const recipientOptions = recipientDirectory?.options ?? [];
  const pendingRecipients = recipientDirectory?.pending ?? [];
  const [recipientEmails, setRecipientEmails] = useState<string[]>([]);
  const [selectedRecipientOption, setSelectedRecipientOption] = useState("");
  const [customRecipientEmail, setCustomRecipientEmail] = useState("");
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");
  const [formFieldsInput, setFormFieldsInput] = useState<
    EditableContactFormField[]
  >(DEFAULT_CONTACT_FORM_FIELDS);
  const manualSourceHostsConfigured =
    parseListInput(sourceHostsInput).length > 0;
  const invalidateContactFormPage = () => invalidatePluginPage();

  useEffect(() => {
    if (!pluginInfo?.config) return;
    setRecipientEmails(
      pluginInfo.config.recipientEmails.map(normalizeEmailAddress),
    );
    setSourceHostsInput(formatListInput(pluginInfo.config.sourceHosts));
    setRedirectHostsInput(
      formatListInput(pluginInfo.config.redirectHostAllowlist),
    );
    setFormFieldsInput(
      (pluginInfo.config.formFields || DEFAULT_CONTACT_FORM_FIELDS).map(
        (field: EditableContactFormField) => ({
          key: field.key || "",
          label: field.label || "",
          type: field.type || "text",
          required: field.required ?? true,
          placeholder: field.placeholder || "",
          rows: field.type === "textarea" ? (field.rows ?? 5) : undefined,
        }),
      ),
    );
  }, [
    pluginInfo?.instanceId,
    pluginInfo?.config?.recipientEmails,
    pluginInfo?.config?.sourceHosts,
    pluginInfo?.config?.redirectHostAllowlist,
    pluginInfo?.config?.formFields,
  ]);

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} snippet copied`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to copy snippet", { description: message });
    }
  };

  const updateFormField = (
    index: number,
    patch: Partial<EditableContactFormField>,
  ) => {
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

    updateConfigMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      config: {
        recipientEmails,
        sourceHosts: parseListInput(sourceHostsInput),
        redirectHostAllowlist: parseListInput(redirectHostsInput),
        formFields: normalizedFormFields,
      },
    });
  };

  const handleRequestRecipientVerification = (
    email: string,
    actionId = "verify_recipient",
  ) => {
    if (!pluginEnabled) return;
    const normalizedEmail = normalizeEmailAddress(email);
    if (!normalizedEmail) {
      toast.error("Select an email first");
      return;
    }

    actionMutation.mutate({
      slug: projectSlug,
      pluginId: typedPluginId,
      actionId,
      args: [normalizedEmail],
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
      previous.filter(
        (entry) => normalizeEmailAddress(entry) !== normalizedEmail,
      ),
    );
  };

  return (
    <SettingsPageShell
      title="Contact Form"
      description={`Configure the Contact Form plugin for ${projectSlug}.`}
      className={
        isEmbedded ? "mx-auto w-full max-w-6xl px-4 py-4 sm:px-6" : undefined
      }
      actions={
        <ProjectPluginPageActions
          projectSlug={projectSlug}
          isEmbedded={isEmbedded}
          onRefresh={() => {
            void refreshPluginPage();
          }}
          isRefreshing={infoQuery.isFetching}
        />
      }
    >
      <FormContent className={isEmbedded ? "mx-auto max-w-3xl" : "max-w-3xl"}>
        <Panel>
          <PanelHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <PanelTitle className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-surface-sunken text-muted-foreground">
                    <PluginIcon className="h-4 w-4" />
                  </span>
                  <span>
                    {pluginInfo?.catalog.name || pluginPresentation.title}
                  </span>
                </PanelTitle>
                <PanelDescription>
                  {pluginInfo?.catalog.description ||
                    "Collect visitor inquiries and store submissions in Vivd."}
                </PanelDescription>
              </div>
              <div className="flex items-center gap-2">
                {!pluginEnabled ? (
                  <ProjectPluginAccessActions
                    canEnablePlugin={
                      contactNeedsProjectEnable && canManageProjectPlugins
                    }
                    canRequestPluginAccess={
                      !(contactNeedsProjectEnable && canManageProjectPlugins) &&
                      canRequestPluginAccess
                    }
                    isEnablePending={ensureMutation.isPending}
                    isRequestPending={isRequestPending}
                    isRequestSubmitting={requestAccessMutation.isPending}
                    requestAccessLabel={requestAccessLabel}
                    onEnable={() =>
                      ensureMutation.mutate({
                        slug: projectSlug,
                        pluginId: typedPluginId,
                      })
                    }
                    onRequestAccess={() =>
                      requestAccessMutation.mutate({
                        slug: projectSlug,
                        pluginId: typedPluginId,
                      })
                    }
                  />
                ) : null}
                <StatusPill
                  tone={
                    pluginEnabled
                      ? "success"
                      : contactNeedsProjectEnable
                        ? "neutral"
                        : "warn"
                  }
                >
                  {pluginEnabled
                    ? "Enabled"
                    : contactNeedsProjectEnable
                      ? "Available"
                      : "Disabled"}
                </StatusPill>
              </div>
            </div>
          </PanelHeader>

          <PanelContent className="space-y-5">
            {infoQuery.error ? (
              <Callout tone="danger">
                <CalloutTitle>
                  Failed to load Contact Form plugin info
                </CalloutTitle>
                <CalloutDescription>
                  {infoQuery.error.message}
                </CalloutDescription>
              </Callout>
            ) : null}

            {!pluginEnabled ? (
              <Callout tone="warn">
                <CalloutDescription>{disabledCopy}</CalloutDescription>
              </Callout>
            ) : null}

            {pluginEnabled ? (
              <>
                <SectionCard
                  title="Recipients"
                  description="Who receives contact form submissions. Only verified email addresses will get notifications."
                >
                  <div className="space-y-4">
                    {recipientEmails.length > 0 ? (
                      <div className="space-y-2">
                        {recipientEmails.map((email) => (
                          <Panel
                            key={email}
                            tone="sunken"
                            className="flex items-center justify-between gap-3 p-3"
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <span>{email}</span>
                              <StatusPill
                                tone="success"
                                className="text-[10px]"
                              >
                                Verified
                              </StatusPill>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveRecipient(email)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </Panel>
                        ))}
                      </div>
                    ) : (
                      <Callout tone="warn">
                        <CalloutDescription>
                          Add an email address to start receiving form
                          submissions.
                        </CalloutDescription>
                      </Callout>
                    )}

                    {pendingRecipients.length > 0 ? (
                      <div className="space-y-2">
                        {pendingRecipients.map(
                          (
                            entry: ContactRecipientDirectory["pending"][number],
                          ) => (
                            <Panel
                              key={entry.email}
                              tone="dashed"
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>{entry.email}</span>
                                <StatusPill tone="warn" className="text-[10px]">
                                  Pending
                                </StatusPill>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleRequestRecipientVerification(
                                    entry.email,
                                    "resend_recipient",
                                  )
                                }
                                disabled={actionMutation.isPending}
                              >
                                Resend
                              </Button>
                            </Panel>
                          ),
                        )}
                      </div>
                    ) : null}

                    <Panel tone="sunken" className="space-y-3 p-3">
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
                              {recipientOptions.map(
                                (
                                  option: ContactRecipientDirectory["options"][number],
                                ) => (
                                  <SelectItem
                                    key={option.email}
                                    value={option.email}
                                    disabled={
                                      option.isVerified || option.isPending
                                    }
                                  >
                                    {option.email}
                                    {option.isVerified
                                      ? " (Verified)"
                                      : option.isPending
                                        ? " (Pending)"
                                        : ""}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            onClick={handleAddSelectedRecipient}
                            disabled={actionMutation.isPending}
                          >
                            {actionMutation.isPending ? (
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
                          disabled={actionMutation.isPending}
                        >
                          {actionMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Add"
                          )}
                        </Button>
                      </div>
                    </Panel>
                  </div>
                </SectionCard>

                <CollapsibleSection
                  title="Form Fields"
                  description="Customize which fields appear on your contact form."
                >
                  <div className="space-y-3">
                    {formFieldsInput.map((field, index) => (
                      <Panel
                        key={`form-field-${index}`}
                        tone="sunken"
                        className="space-y-3 p-3"
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
                            <Label
                              htmlFor={`contact-field-key-${index}`}
                              className="text-xs"
                            >
                              Field key
                            </Label>
                            <Input
                              id={`contact-field-key-${index}`}
                              value={field.key}
                              onChange={(event) =>
                                updateFormField(index, {
                                  key: event.target.value,
                                })
                              }
                              placeholder="name"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label
                              htmlFor={`contact-field-label-${index}`}
                              className="text-xs"
                            >
                              Label
                            </Label>
                            <Input
                              id={`contact-field-label-${index}`}
                              value={field.label}
                              onChange={(event) =>
                                updateFormField(index, {
                                  label: event.target.value,
                                })
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
                                  rows:
                                    value === "textarea"
                                      ? (field.rows ?? 5)
                                      : undefined,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">Text</SelectItem>
                                <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="textarea">
                                  Textarea
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label
                              htmlFor={`contact-field-placeholder-${index}`}
                              className="text-xs"
                            >
                              Placeholder
                            </Label>
                            <Input
                              id={`contact-field-placeholder-${index}`}
                              value={field.placeholder}
                              onChange={(event) =>
                                updateFormField(index, {
                                  placeholder: event.target.value,
                                })
                              }
                              placeholder="Optional"
                            />
                          </div>
                          {field.type === "textarea" ? (
                            <div className="space-y-1">
                              <Label
                                htmlFor={`contact-field-rows-${index}`}
                                className="text-xs"
                              >
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
                              updateFormField(index, {
                                required: checked === true,
                              })
                            }
                          />
                          <Label
                            htmlFor={`contact-field-required-${index}`}
                            className="font-normal text-xs"
                          >
                            Required
                          </Label>
                        </div>
                      </Panel>
                    ))}
                    <Button variant="outline" size="sm" onClick={addFormField}>
                      <Plus className="mr-1 h-4 w-4" />
                      Add field
                    </Button>
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Advanced Settings"
                  description="Source hosts, redirect allowlists, and other security settings."
                >
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="contact-source-hosts"
                        className="text-xs font-medium"
                      >
                        Allowed source hosts
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Leave empty to automatically use published, tenant, and
                        Studio preview hosts. Entering values here overrides
                        that auto-detected list.
                      </p>
                      <Textarea
                        id="contact-source-hosts"
                        value={sourceHostsInput}
                        onChange={(event) =>
                          setSourceHostsInput(event.target.value)
                        }
                        placeholder={"mydomain.com\nwww.mydomain.com"}
                        rows={3}
                      />
                      {inferredAutoSourceHosts.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Auto-detected: {inferredAutoSourceHosts.join(", ")}
                        </p>
                      ) : null}
                      {manualSourceHostsConfigured ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          Manual override active. Submission and Turnstile host
                          checks now use only the hosts above until you clear
                          this field.
                        </p>
                      ) : null}
                      {effectiveSourceHosts.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Effective submit hosts:{" "}
                          {effectiveSourceHosts.join(", ")}
                        </p>
                      ) : null}
                      {turnstileExpectedDomains.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Expected Turnstile domains:{" "}
                          {turnstileExpectedDomains.join(", ")}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label
                        htmlFor="contact-redirect-hosts"
                        className="text-xs font-medium"
                      >
                        Allowed redirect hosts
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Validates the redirect URL after successful form
                        submission.
                      </p>
                      <Textarea
                        id="contact-redirect-hosts"
                        value={redirectHostsInput}
                        onChange={(event) =>
                          setRedirectHostsInput(event.target.value)
                        }
                        placeholder="mydomain.com"
                        rows={3}
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Embed Snippets"
                  description="Copy a snippet to add the contact form to your website."
                >
                  {snippets ? (
                    <div className="space-y-4">
                      <SnippetCard
                        title="HTML"
                        snippet={snippets.html}
                        onCopy={() => void handleCopy(snippets.html, "HTML")}
                      />
                      <SnippetCard
                        title="Astro"
                        snippet={snippets.astro}
                        onCopy={() => void handleCopy(snippets.astro, "Astro")}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Snippets are available after the plugin is enabled.
                    </p>
                  )}
                </CollapsibleSection>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSaveConfig}
                    disabled={updateConfigMutation.isPending}
                  >
                    {updateConfigMutation.isPending ? (
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
          </PanelContent>
        </Panel>
      </FormContent>
    </SettingsPageShell>
  );
}
