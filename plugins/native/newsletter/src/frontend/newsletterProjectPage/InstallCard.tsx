import { Panel, PanelContent, PanelHeader, PanelTitle } from "@vivd/ui";
import type { NewsletterPluginInfo } from "./types";

export function NewsletterInstallCard({
  pluginInfo,
}: {
  pluginInfo: NewsletterPluginInfo;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Install</PanelTitle>
      </PanelHeader>
      <PanelContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">HTML</p>
            <Panel tone="sunken" className="overflow-auto p-3">
              <pre className="text-xs whitespace-pre-wrap">
                {pluginInfo?.snippets?.html ||
                  "Enable the plugin to generate a snippet."}
              </pre>
            </Panel>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Astro</p>
            <Panel tone="sunken" className="overflow-auto p-3">
              <pre className="text-xs whitespace-pre-wrap">
                {pluginInfo?.snippets?.astro ||
                  "Enable the plugin to generate a snippet."}
              </pre>
            </Panel>
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
      </PanelContent>
    </Panel>
  );
}
