import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

/**
 * StatusPill — small rounded-full chip for binary/enum statuses.
 *
 * Replaces the hand-rolled "rounded-full border bg-background px-2 py-1"
 * and "rounded-full border bg-emerald-500/10 ..." chips scattered across
 * admin surfaces.
 *
 * Use for status indicators (Active / Deployed / Not installed / Blocked).
 * Badge remains the right choice for non-status count/label chips.
 */

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize leading-none",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-sunken text-muted-foreground",
        info: "border-primary/30 bg-primary/10 text-primary",
        success:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        danger: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

const dotToneClass: Record<
  NonNullable<VariantProps<typeof statusPillVariants>["tone"]>,
  string
> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-primary",
  success: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-destructive",
};

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  dot?: boolean;
}

const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, tone, dot, children, ...props }, ref) => {
    const toneKey = tone ?? "neutral";
    return (
      <span
        ref={ref}
        className={cn(statusPillVariants({ tone }), className)}
        {...props}
      >
        {dot ? (
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", dotToneClass[toneKey])}
          />
        ) : null}
        {children}
      </span>
    );
  },
);
StatusPill.displayName = "StatusPill";

export { StatusPill, statusPillVariants };
