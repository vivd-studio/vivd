import { ProjectsList } from "@/components/ProjectsList";
import { ProjectWizard } from "@/components/ProjectWizard";

export default function Dashboard() {
  return (
    <div className="p-8 space-y-8">
      <ProjectWizard onGenerationStarted={() => {}} />

      <ProjectsList />
    </div>
  );
}
