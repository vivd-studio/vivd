import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

/**
 * Panel — the primary elevated section container.
 *
 * Replaces ad-hoc Card usage for page-level and subsection containers.
 * Consumes the surface token system:
 *   - tone="default" : bg-surface-panel  (sits on surface-page)
 *   - tone="sunken"  : bg-surface-sunken (well inside a parent panel)
 *   - tone="dashed"  : transparent with dashed border (empty states)
 *
 * Do not pass ad-hoc bg-* utilities — pick a tone instead, or file an issue
 * if none fits.
 */

const panelVariants = cva(
  "rounded-xl border text-foreground transition-colors",
  {
    variants: {
      tone: {
        default: "border-border bg-surface-panel shadow-sm",
        sunken: "border-border bg-surface-sunken shadow-none",
        dashed: "border-dashed border-border bg-transparent shadow-none",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

export interface PanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof panelVariants> {}

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, tone, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(panelVariants({ tone }), className)}
      {...props}
    />
  ),
);
Panel.displayName = "Panel";

const PanelHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { separated?: boolean }
>(({ className, separated, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col gap-1.5 p-5",
      separated && "border-b border-border",
      className,
    )}
    {...props}
  />
));
PanelHeader.displayName = "PanelHeader";

const PanelTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-base font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
PanelTitle.displayName = "PanelTitle";

const PanelDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
PanelDescription.displayName = "PanelDescription";

const PanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
));
PanelContent.displayName = "PanelContent";

const PanelFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { separated?: boolean }
>(({ className, separated, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-2 p-5 pt-0",
      separated && "border-t border-border pt-5",
      className,
    )}
    {...props}
  />
));
PanelFooter.displayName = "PanelFooter";

export {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelDescription,
  PanelContent,
  PanelFooter,
  panelVariants,
};
