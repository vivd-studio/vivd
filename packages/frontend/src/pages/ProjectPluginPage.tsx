import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import GenericProjectPluginPage from "@/plugins/GenericProjectPluginPage";
import { getProjectPluginUi } from "@/plugins/registry";

export default function ProjectPluginPage() {
  const { projectSlug, pluginId } = useParams<{
    projectSlug: string;
    pluginId: string;
  }>();
  const location = useLocation();
  const isEmbedded = useMemo(
    () => new URLSearchParams(location.search).get("embedded") === "1",
    [location.search],
  );

  if (!projectSlug || !pluginId) {
    return <div className="text-sm text-muted-foreground">Missing plugin route.</div>;
  }

  const pluginUi = getProjectPluginUi(pluginId);
  if (pluginUi?.ProjectPage) {
    const ProjectPage = pluginUi.ProjectPage;
    return <ProjectPage projectSlug={projectSlug} isEmbedded={isEmbedded} />;
  }

  return (
    <GenericProjectPluginPage
      projectSlug={projectSlug}
      pluginId={pluginId}
      isEmbedded={isEmbedded}
    />
  );
}
