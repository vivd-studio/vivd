import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { darkSemanticBadgeTones } from "./semanticTones";
import { cn } from "./utils";

/**
 * StatusPill — small badge-like chip for binary/enum statuses.
 *
 * Replaces the hand-rolled "rounded-md border bg-background px-2 py-1"
 * and "rounded-md border bg-emerald-500/10 ..." chips scattered across
 * admin surfaces.
 *
 * Use for status indicators (Active / Deployed / Not installed / Blocked).
 * Badge remains the right choice for non-status count/label chips.
 * The optional dot is a special-case accent, not the default status treatment.
 */

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-0.5 text-xs font-semibold capitalize transition-colors",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-secondary text-secondary-foreground",
        info:
          `border-transparent bg-primary text-primary-foreground shadow-sm ${darkSemanticBadgeTones.default}`,
        success:
          `border-transparent bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] shadow-sm hover:bg-[hsl(var(--success-hover))] ${darkSemanticBadgeTones.success}`,
        warn:
          "border-transparent bg-amber-500 text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:shadow-none",
        danger:
          `border-transparent bg-destructive text-destructive-foreground shadow-sm ${darkSemanticBadgeTones.destructive}`,
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

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
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              toneKey === "neutral" ? "bg-current/55" : "bg-current",
            )}
          />
        ) : null}
        {children}
      </span>
    );
  },
);
StatusPill.displayName = "StatusPill";

export { StatusPill, statusPillVariants };
