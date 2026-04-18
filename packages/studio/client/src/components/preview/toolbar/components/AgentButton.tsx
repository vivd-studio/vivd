import { Button } from "@vivd/ui";

import { MessageSquare } from "lucide-react";

interface AgentButtonProps {
  projectSlug: string | undefined;
  chatOpen: boolean;
  setChatOpen: (value: boolean) => void;
  canUseAgent: boolean;
}

export function AgentButton({
  projectSlug,
  chatOpen,
  setChatOpen,
  canUseAgent,
}: AgentButtonProps) {
  if (!projectSlug || !canUseAgent) return null;

  return (
    <Button
      variant={chatOpen ? "secondary" : "outline"}
      size="sm"
      onClick={() => setChatOpen(!chatOpen)}
      className={`hidden md:flex h-8 ${
        !chatOpen
          ? "border-violet-500/50 bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400"
          : ""
      }`}
    >
      <MessageSquare className="w-4 h-4 mr-1.5" />
      <span className="hidden lg:inline">Agent</span>
    </Button>
  );
}
