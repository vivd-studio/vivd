import { Button } from "@vivd/ui";

import { FolderOpen } from "lucide-react";

interface AssetsButtonProps {
  projectSlug: string | undefined;
  assetsOpen: boolean;
  setAssetsOpen: (value: boolean) => void;
}

export function AssetsButton({
  projectSlug,
  assetsOpen,
  setAssetsOpen,
}: AssetsButtonProps) {
  if (!projectSlug) return null;

  return (
    <Button
      variant={assetsOpen ? "secondary" : "outline"}
      size="sm"
      onClick={() => setAssetsOpen(!assetsOpen)}
      className={`hidden md:flex h-8 ${
        !assetsOpen
          ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
          : ""
      }`}
    >
      <FolderOpen className="w-4 h-4 mr-1.5" />
      <span className="hidden lg:inline">Assets</span>
    </Button>
  );
}
