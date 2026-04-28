import { ProjectsList } from "@/components/projects";
import {
  FramedViewport,
  HOST_VIEWPORT_INSET_CLASS,
} from "@/components/common/FramedHostShell";

export default function Dashboard() {
  return (
    <div className={HOST_VIEWPORT_INSET_CLASS}>
      <FramedViewport>
        <div className="h-full min-h-0 flex-1 overflow-auto px-4 py-3 md:px-4">
          <div className="mb-5 py-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Your Projects
            </h1>
          </div>
          <ProjectsList />
        </div>
      </FramedViewport>
    </div>
  );
}
