import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { X, Sparkles } from "lucide-react";
import { ModeToggle } from "@/components/mode-toggle";
import faviconSvg from "/favicon-transparent.svg";

export function ScratchHeader() {
  const navigate = useNavigate();

  const handleClose = () => {
    navigate("/vivd-studio");
  };

  return (
    <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-1 md:gap-2 shrink-0 z-10 bg-background">
      {/* Left Section: App Icon + Title */}
      <button
        onClick={handleClose}
        className="hover:opacity-80 transition-opacity focus:outline-none cursor-pointer"
      >
        <img src={faviconSvg} alt="vivd" className="h-6 w-6 shrink-0" />
      </button>

      {/* Separator */}
      <div className="hidden sm:block h-5 w-px bg-border mx-1" />

      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="hidden sm:inline font-medium text-muted-foreground">
          Scratch Wizard
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right Section: Theme Toggle + Close */}
      <div className="flex items-center gap-1">
        <ModeToggle />

        <div className="hidden md:block h-5 w-px bg-border mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back to Dashboard</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
