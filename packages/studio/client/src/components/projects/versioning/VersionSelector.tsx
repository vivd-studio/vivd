import {
  Badge,
  type BadgeProps,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vivd/ui";

import { Check, ChevronDown, Layers, Settings2 } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";

type VersionStatus = "completed" | "failed" | "unknown" | string;

export interface VersionSelectorVersion {
  version: number;
  status?: VersionStatus;
}

interface VersionSelectorProps {
  selectedVersion: number;
  versions: VersionSelectorVersion[];
  onSelect: (version: number) => void;
  stopPropagation?: boolean;
  showStatusMarker?: boolean;
  renderStatusMarker?: (version: VersionSelectorVersion) => ReactNode;
  triggerVariant?: BadgeProps["variant"];
  triggerClassName?: string;
  triggerTitle?: string;
  label?: string;
  align?: "start" | "center" | "end";
  onManageVersions?: () => void;
}

function defaultStatusMarker(version: VersionSelectorVersion) {
  const status = version.status;
  return (
    <span
      className={`ml-auto text-xs ${
        status === "completed"
          ? "text-emerald-600 dark:text-emerald-400"
          : status === "failed"
            ? "text-destructive"
            : "text-muted-foreground"
      }`}
    >
      {status === "completed" ? "✓" : status === "failed" ? "✗" : "..."}
    </span>
  );
}

export function VersionSelector({
  selectedVersion,
  versions,
  onSelect,
  stopPropagation = false,
  showStatusMarker = true,
  renderStatusMarker,
  triggerVariant = "secondary",
  triggerClassName = "",
  triggerTitle,
  label = "Select Version",
  align = "start",
  onManageVersions,
}: VersionSelectorProps) {
  const hasMultipleVersions = versions.length > 1;

  const handleStopPropagation: MouseEventHandler<HTMLElement> | undefined =
    stopPropagation ? (e) => e.stopPropagation() : undefined;

  if (!hasMultipleVersions) {
    return (
      <Badge
        variant={triggerVariant}
        className={triggerClassName}
        title={triggerTitle}
      >
        <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge
          variant={triggerVariant}
          className={triggerClassName}
          title={
            triggerTitle ?? `Click to select from ${versions.length} versions`
          }
          onClick={handleStopPropagation}
        >
          <Layers className="w-3 h-3 mr-1" />v{selectedVersion}
          <ChevronDown className="w-3 h-3 ml-1" />
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={handleStopPropagation}>
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {versions.map((version) => (
          <DropdownMenuItem
            key={version.version}
            onClick={() => onSelect(version.version)}
            className={
              selectedVersion === version.version ? "bg-surface-sunken" : ""
            }
          >
            <Check
              className={`w-4 h-4 mr-2 ${
                selectedVersion === version.version
                  ? "opacity-100"
                  : "opacity-0"
              }`}
            />
            <span>v{version.version}</span>
            {showStatusMarker
              ? (renderStatusMarker ?? defaultStatusMarker)(version)
              : null}
          </DropdownMenuItem>
        ))}
        {onManageVersions && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onManageVersions}>
              <Settings2 className="w-4 h-4 mr-2" />
              Manage versions...
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
