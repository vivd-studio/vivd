import { ProjectsList } from "@/components/ProjectsList";
import { GenerateSection } from "@/components/GenerateSection";

export default function Dashboard() {
  return (
    <div className="p-8 space-y-8">
      <GenerateSection onGenerationStarted={() => {}} />

      <ProjectsList />
    </div>
  );
}
