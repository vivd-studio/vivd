import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

/**
 * Callout — toned notice box for inline messages inside a Panel.
 *
 * Replaces hand-rolled "rounded border bg-orange-50 dark:bg-orange-950/30"
 * constructions. Uses low-opacity tints that composite cleanly over any
 * parent surface, so callouts read correctly in both light and dark.
 *
 * Tones:
 *   - info    : neutral information, primary-tinted
 *   - warn    : amber — action recommended
 *   - success : emerald — confirmation of a completed state
 *   - danger  : destructive — blocking or error state
 */

const calloutVariants = cva(
  "flex gap-3 rounded-md border p-4 text-sm text-foreground",
  {
    variants: {
      tone: {
        info: "border-primary/30 bg-primary/10 [&_[data-callout-icon]]:text-primary",
        warn: "border-amber-500/40 bg-amber-500/10 [&_[data-callout-icon]]:text-amber-600 dark:[&_[data-callout-icon]]:text-amber-400",
        success:
          "border-emerald-500/40 bg-emerald-500/10 [&_[data-callout-icon]]:text-emerald-600 dark:[&_[data-callout-icon]]:text-emerald-400",
        danger:
          "border-destructive/40 bg-destructive/10 [&_[data-callout-icon]]:text-destructive",
      },
    },
    defaultVariants: {
      tone: "info",
    },
  },
);

export interface CalloutProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof calloutVariants> {
  icon?: React.ReactNode;
}

const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(
  ({ className, tone, icon, children, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      className={cn(calloutVariants({ tone }), className)}
      {...props}
    >
      {icon ? (
        <span
          data-callout-icon
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center [&>svg]:size-4"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  ),
);
Callout.displayName = "Callout";

const CalloutTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm font-medium leading-tight", className)}
    {...props}
  />
));
CalloutTitle.displayName = "CalloutTitle";

const CalloutDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm leading-snug text-muted-foreground", className)}
    {...props}
  />
));
CalloutDescription.displayName = "CalloutDescription";

export { Callout, CalloutTitle, CalloutDescription, calloutVariants };
