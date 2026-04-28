import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { ROUTES } from "@/app/router";

export function ProjectWizard() {
  const navigate = useNavigate();

  const handleNewProjectClick = () => {
    navigate(ROUTES.NEW_SCRATCH);
  };

  return (
    <button
      type="button"
      onClick={handleNewProjectClick}
      className="flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:underline focus-visible:underline-offset-4"
    >
      <Plus className="h-4 w-4" />
      New
    </button>
  );
}
