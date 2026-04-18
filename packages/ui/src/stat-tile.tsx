import * as React from "react";

import { cn } from "./utils";

/**
 * StatTile — a nested metric tile that sits inside a Panel.
 *
 * Uses surface-sunken so it recedes against the parent Panel. Replaces the
 * hand-rolled "rounded border bg-card p-4" / "rounded-xl border bg-background/70 p-4"
 * variants that were drifting across the admin surfaces.
 *
 * Compose the contents with the provided sub-components to keep typography
 * consistent across the app.
 */

const StatTile = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-4 text-foreground",
      className,
    )}
    {...props}
  />
));
StatTile.displayName = "StatTile";

const StatTileLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center justify-between text-sm font-medium text-muted-foreground",
      className,
    )}
    {...props}
  />
));
StatTileLabel.displayName = "StatTileLabel";

const StatTileValue = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight tabular-nums",
      className,
    )}
    {...props}
  />
));
StatTileValue.displayName = "StatTileValue";

const StatTileMeta = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center justify-between text-sm text-muted-foreground tabular-nums",
      className,
    )}
    {...props}
  />
));
StatTileMeta.displayName = "StatTileMeta";

const StatTileHelper = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
StatTileHelper.displayName = "StatTileHelper";

export { StatTile, StatTileLabel, StatTileValue, StatTileMeta, StatTileHelper };
