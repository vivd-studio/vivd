import { ProjectsList } from "@/components/projects";
import {
  FramedViewport,
  HOST_VIEWPORT_INSET_CLASS,
} from "@/components/common/FramedHostShell";
import { PageHeader, PageHeaderContent, PageTitle } from "@vivd/ui";

export default function Dashboard() {
  return (
    <div className={HOST_VIEWPORT_INSET_CLASS}>
      <FramedViewport className="border-0 shadow-none dark:shadow-none">
        <div className="h-full min-h-0 flex-1 overflow-auto px-4 py-3 md:px-4">
          <PageHeader className="mb-5 py-2">
            <PageHeaderContent>
              <PageTitle>Your Projects</PageTitle>
            </PageHeaderContent>
          </PageHeader>
          <ProjectsList />
        </div>
      </FramedViewport>
    </div>
  );
}
