import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NewsletterPluginInfo } from "./types";

export function NewsletterInstallCard({
  pluginInfo,
}: {
  pluginInfo: NewsletterPluginInfo;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Install</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">HTML</p>
            <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {pluginInfo?.snippets?.html || "Enable the plugin to generate a snippet."}
            </pre>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Astro</p>
            <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {pluginInfo?.snippets?.astro || "Enable the plugin to generate a snippet."}
            </pre>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Subscribe endpoint</p>
            <p className="text-sm font-medium break-all">
              {pluginInfo?.usage?.subscribeEndpoint || "n/a"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expected fields</p>
            <p className="text-sm font-medium">
              {pluginInfo?.usage?.expectedFields?.join(", ") || "n/a"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Auto source hosts</p>
            <p className="text-sm font-medium break-words">
              {pluginInfo?.usage?.inferredAutoSourceHosts?.join(", ") || "n/a"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
