import { useParams } from "react-router-dom";
import { getProjectPluginOperatorPage } from "@/plugins/registry";
import { Panel } from "@vivd/ui";

export default function ProjectPluginOperatorPage() {
  const { projectSlug, pluginId } = useParams<{
    projectSlug: string;
    pluginId: string;
  }>();

  if (!projectSlug || !pluginId) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        <Panel tone="dashed" className="px-6 py-4 text-center">
          Missing plugin route.
        </Panel>
      </div>
    );
  }

  const OperatorPage = getProjectPluginOperatorPage(pluginId);
  if (!OperatorPage) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        <Panel tone="dashed" className="px-6 py-4">
          This plugin does not provide a service-mode screen.
        </Panel>
      </div>
    );
  }

  return <OperatorPage projectSlug={projectSlug} />;
}
