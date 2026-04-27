import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { VivdIcon } from "./VivdIcon";

type SidebarPanelToggleGlyphProps = React.ComponentProps<"span"> & {
  open?: boolean;
  iconClassName?: string;
};

type SidebarBrandToggleGlyphProps = React.ComponentProps<"span"> & {
  appearance?: "brand" | "panel";
  morphOnHover?: boolean;
  open?: boolean;
  panelIconClassName?: string;
};

export function SidebarPanelToggleGlyph({
  className,
  iconClassName,
  open = false,
  ...props
}: SidebarPanelToggleGlyphProps) {
  const action = open ? "close" : "open";
  const baseIconClassName = cn(
    "absolute transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
    iconClassName,
  );

  return (
    <span
      aria-hidden="true"
      data-sidebar-panel-action={action}
      className={cn("relative flex items-center justify-center", className)}
      {...props}
    >
      <PanelLeftOpen
        data-sidebar-panel-glyph="open"
        className={cn(
          baseIconClassName,
          open
            ? "rotate-90 scale-90 opacity-0"
            : "rotate-0 scale-100 opacity-100",
        )}
      />
      <PanelLeftClose
        data-sidebar-panel-glyph="close"
        className={cn(
          baseIconClassName,
          open
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-90 opacity-0",
        )}
      />
    </span>
  );
}

export function SidebarBrandToggleGlyph({
  appearance = "brand",
  className,
  morphOnHover = true,
  open = false,
  panelIconClassName,
  ...props
}: SidebarBrandToggleGlyphProps) {
  const panelVisibleClassName =
    appearance === "panel"
      ? "delay-150 scale-100 opacity-100"
      : morphOnHover
        ? "group-hover/sidebar-trigger:delay-150 group-hover/sidebar-trigger:scale-100 group-hover/sidebar-trigger:opacity-100 group-focus/sidebar-trigger:delay-150 group-focus/sidebar-trigger:scale-100 group-focus/sidebar-trigger:opacity-100"
        : "";
  const brandHiddenClassName =
    appearance === "panel"
      ? "delay-0 scale-90 opacity-0"
      : morphOnHover
        ? "group-hover/sidebar-trigger:delay-150 group-hover/sidebar-trigger:scale-90 group-hover/sidebar-trigger:opacity-0 group-focus/sidebar-trigger:delay-150 group-focus/sidebar-trigger:scale-90 group-focus/sidebar-trigger:opacity-0"
        : "";

  return (
    <span
      className={cn(
        "relative flex items-center justify-center",
        appearance === "panel" ? "size-4" : "size-6",
        className,
      )}
      {...props}
    >
      <VivdIcon
        aria-hidden="true"
        data-sidebar-brand-glyph="brand"
        className={cn(
          "absolute !size-6 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] delay-0 motion-reduce:transition-none",
          brandHiddenClassName,
        )}
        strokeWidth={12}
      />
      <SidebarPanelToggleGlyph
        open={open}
        data-sidebar-brand-glyph="panel"
        className={cn(
          "absolute scale-90 opacity-0 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] delay-0 motion-reduce:transition-none",
          appearance === "panel" ? "size-4" : "size-[18px]",
          panelVisibleClassName,
        )}
        iconClassName={cn(
          appearance === "panel" ? "!size-4" : "!size-[18px]",
          panelIconClassName,
        )}
      />
    </span>
  );
}
