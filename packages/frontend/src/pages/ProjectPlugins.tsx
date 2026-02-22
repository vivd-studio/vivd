import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
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
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SnippetKind = "html" | "astro";

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
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copy
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words overflow-auto max-h-96">
          {snippet}
        </pre>
      </CardContent>
    </Card>
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

  const contactCatalogEntry = useMemo(
    () =>
      catalogQuery.data?.available.find((plugin) => plugin.pluginId === "contact_form"),
    [catalogQuery.data?.available],
  );

  const contactInfo = contactInfoQuery.data;
  const pluginEnabled = !!contactInfo?.enabled;
  const snippets = contactInfo?.snippets;
  const [recipientEmailsInput, setRecipientEmailsInput] = useState("");
  const [sourceHostsInput, setSourceHostsInput] = useState("");
  const [redirectHostsInput, setRedirectHostsInput] = useState("");

  const handleCopy = async (value: string, kind: SnippetKind) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${kind.toUpperCase()} snippet copied`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to copy snippet", { description: message });
    }
  };

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

  useEffect(() => {
    if (!contactInfo?.config) return;
    setRecipientEmailsInput(formatListInput(contactInfo.config.recipientEmails));
    setSourceHostsInput(formatListInput(contactInfo.config.sourceHosts));
    setRedirectHostsInput(formatListInput(contactInfo.config.redirectHostAllowlist));
  }, [
    contactInfo?.instanceId,
    contactInfo?.config?.recipientEmails,
    contactInfo?.config?.sourceHosts,
    contactInfo?.config?.redirectHostAllowlist,
  ]);

  const handleSaveConfig = () => {
    const recipientEmails = parseListInput(recipientEmailsInput);
    if (recipientEmails.length === 0) {
      toast.error("Add at least one recipient email");
      return;
    }

    updateContactConfigMutation.mutate({
      slug,
      config: {
        recipientEmails,
        sourceHosts: parseListInput(sourceHostsInput),
        redirectHostAllowlist: parseListInput(redirectHostsInput),
      },
    });
  };

  if (!projectSlug) {
    return (
      <div className="text-sm text-muted-foreground">Missing project slug.</div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Plugins</h1>
          <p className="text-sm text-muted-foreground">
            Configure runtime plugins for <span className="font-medium">{projectSlug}</span>.
          </p>
        </div>
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
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
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
        <CardContent className="space-y-4">
          {catalogQuery.error ? (
            <div className="text-sm text-destructive">
              Failed to load plugin catalog: {catalogQuery.error.message}
            </div>
          ) : null}
          {contactInfoQuery.error ? (
            <div className="text-sm text-destructive">
              Failed to load Contact Form plugin info: {contactInfoQuery.error.message}
            </div>
          ) : null}

          {!pluginEnabled ? (
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
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enabling...
                </>
              ) : (
                "Enable Contact Form"
              )}
            </Button>
          ) : null}

          {contactInfo?.usage ? (
            <div className="text-sm">
              <span className="font-medium">Submit endpoint:</span>{" "}
              <code className="text-xs">{contactInfo.usage.submitEndpoint}</code>
            </div>
          ) : null}
          {contactInfo?.publicToken ? (
            <div className="text-sm">
              <span className="font-medium">Public token:</span>{" "}
              <code className="text-xs break-all">{contactInfo.publicToken}</code>
            </div>
          ) : null}
          {pluginEnabled && (contactInfo?.config?.recipientEmails?.length || 0) === 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Contact Form is enabled, but no recipient email is configured yet.
            </div>
          ) : null}

          {pluginEnabled ? (
            <>
              <Separator />
              <div className="space-y-3">
                <h2 className="text-sm font-medium">Configuration</h2>
                <div className="space-y-2">
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
                  <p className="text-xs text-muted-foreground">
                    One email per line (comma-separated also supported).
                  </p>
                </div>
                <div className="space-y-2">
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
                  <p className="text-xs text-muted-foreground">
                    Empty means submissions are accepted from any host. Recommended:
                    list only your project domains.
                  </p>
                </div>
                <div className="space-y-2">
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
                  <p className="text-xs text-muted-foreground">
                    Redirects users after successful submit via <code>_redirect</code>.
                    If empty, source hosts are used as fallback. If both lists are
                    empty, redirects are disabled.
                  </p>
                </div>
                <Button
                  onClick={handleSaveConfig}
                  disabled={updateContactConfigMutation.isPending}
                >
                  {updateContactConfigMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save configuration"
                  )}
                </Button>
              </div>
            </>
          ) : null}

          {contactInfo?.instructions?.length ? (
            <>
              <Separator />
              <div className="space-y-2">
                <h2 className="text-sm font-medium">Instructions</h2>
                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                  {contactInfo.instructions.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

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
      ) : null}
    </div>
  );
}
