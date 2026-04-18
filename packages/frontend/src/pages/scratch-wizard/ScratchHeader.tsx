import { useNavigate } from "react-router-dom";
import { Button } from "@vivd/ui";

import { ArrowLeft, X } from "lucide-react";
import { ModeToggle } from "@/components/theme";
import { VivdIcon } from "@/components/common";
import { ROUTES } from "@/app/router";

export function ScratchHeader() {
  const navigate = useNavigate();

  const handleClose = () => {
    navigate(ROUTES.DASHBOARD);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        onClick={handleClose}
        className="group inline-flex h-8 items-center gap-2 rounded-md border border-border/60 bg-card/54 px-2.5 text-sm text-foreground transition hover:border-primary/20 hover:bg-card/84 hover:text-foreground focus:outline-none"
      >
        <ArrowLeft className="h-4 w-4 opacity-75 transition group-hover:-translate-x-0.5 group-hover:opacity-100" />
        <VivdIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Projects</span>
      </button>

      <div className="flex items-center gap-1.5">
        <ModeToggle />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-8 rounded-md border border-border/60 bg-card/54 px-2.5 text-foreground hover:border-primary/20 hover:bg-card/84 hover:text-foreground"
        >
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Close</span>
        </Button>
      </div>
    </div>
  );
}
