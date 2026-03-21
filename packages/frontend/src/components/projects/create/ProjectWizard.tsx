import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { ROUTES } from "@/app/router";

interface ProjectWizardProps {
  onGenerationStarted?: (slug: string, version?: number) => void;
}

export function ProjectWizard(_props: ProjectWizardProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(ROUTES.NEW_SCRATCH)}
      className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
    >
      <Plus className="h-4 w-4" />
      New Project
    </button>
  );
}
