import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { VivdIcon } from "./VivdIcon";

type SidebarBrandToggleGlyphProps = React.ComponentProps<"span"> & {
  morphOnHover?: boolean;
};

export function SidebarBrandToggleGlyph({
  className,
  morphOnHover = true,
  ...props
}: SidebarBrandToggleGlyphProps) {
  return (
    <span
      className={cn("relative flex items-center justify-center", className)}
      {...props}
    >
      <VivdIcon
        aria-hidden="true"
        data-sidebar-brand-glyph="brand"
        className={cn(
          "!size-6 transition-all duration-150 ease-out",
          morphOnHover &&
            "group-hover/sidebar-trigger:scale-90 group-hover/sidebar-trigger:opacity-0 group-focus/sidebar-trigger:scale-90 group-focus/sidebar-trigger:opacity-0",
        )}
        strokeWidth={12}
      />
      <PanelLeft
        aria-hidden="true"
        data-sidebar-brand-glyph="panel"
        className={cn(
          "!size-[18px] absolute scale-90 opacity-0 transition-all duration-150 ease-out",
          morphOnHover &&
            "group-hover/sidebar-trigger:scale-100 group-hover/sidebar-trigger:opacity-100 group-focus/sidebar-trigger:scale-100 group-focus/sidebar-trigger:opacity-100",
        )}
      />
    </span>
  );
}
