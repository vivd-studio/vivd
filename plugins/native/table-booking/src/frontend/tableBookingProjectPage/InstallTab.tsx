import { SectionCard, SnippetCard, SurfaceList } from "./shared";
import type { TableBookingPluginInfo } from "./types";

type InstallTabProps = {
  pluginInfo: TableBookingPluginInfo | undefined;
  copyText: (value: string, label: string) => Promise<void>;
};

export function TableBookingInstallTab({
  pluginInfo,
  copyText,
}: InstallTabProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <SectionCard
          title="Widget endpoints"
          description="These are the live endpoints the generated widget calls."
        >
          {pluginInfo?.usage ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-background px-3 py-3 text-xs">
                <p className="font-medium text-muted-foreground">Availability</p>
                <p className="mt-1 break-all font-mono">
                  {pluginInfo.usage.availabilityEndpoint}
                </p>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3 text-xs">
                <p className="font-medium text-muted-foreground">Book</p>
                <p className="mt-1 break-all font-mono">
                  {pluginInfo.usage.bookEndpoint}
                </p>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3 text-xs">
                <p className="font-medium text-muted-foreground">Cancel</p>
                <p className="mt-1 break-all font-mono">
                  {pluginInfo.usage.cancelEndpoint}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enable the plugin for this project to see the live widget endpoints.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Form contract"
          description="Expected and optional fields for custom widget integrations."
        >
          {pluginInfo?.usage ? (
            <div className="space-y-4">
              <SurfaceList
                title="Required fields"
                description="These fields are expected in booking submissions."
                values={pluginInfo.usage.expectedFields ?? []}
                emptyCopy="No required fields listed."
              />
              <SurfaceList
                title="Optional fields"
                description="These fields can be sent when available."
                values={pluginInfo.usage.optionalFields ?? []}
                emptyCopy="No optional fields listed."
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enable the plugin to inspect the widget field contract.
            </p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Generated snippets"
        description="Use these instead of rebuilding the widget contract by hand."
      >
        {pluginInfo?.snippets ? (
          <div className="space-y-6">
            <SnippetCard
              title="HTML"
              snippet={pluginInfo.snippets.html}
              onCopy={() =>
                void copyText(pluginInfo.snippets?.html || "", "HTML snippet")
              }
            />
            <SnippetCard
              title="Astro"
              snippet={pluginInfo.snippets.astro}
              onCopy={() =>
                void copyText(pluginInfo.snippets?.astro || "", "Astro snippet")
              }
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enable the plugin for this project to generate install snippets.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
