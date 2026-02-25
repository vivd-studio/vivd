import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const interactiveSurfaceVariants = cva("", {
  variants: {
    variant: {
      field: "vivd-surface-field",
      choice: "vivd-surface-choice",
      choiceDashed: "vivd-surface-choice-dashed",
    },
  },
  defaultVariants: {
    variant: "choice",
  },
});

export interface InteractiveSurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof interactiveSurfaceVariants> {}

const InteractiveSurface = React.forwardRef<HTMLDivElement, InteractiveSurfaceProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(interactiveSurfaceVariants({ variant }), className)}
      {...props}
    />
  )
);
InteractiveSurface.displayName = "InteractiveSurface";

export interface InteractiveSurfaceButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof interactiveSurfaceVariants> {}

const InteractiveSurfaceButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveSurfaceButtonProps
>(({ className, variant, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(interactiveSurfaceVariants({ variant }), className)}
    {...props}
  />
));
InteractiveSurfaceButton.displayName = "InteractiveSurfaceButton";

export { InteractiveSurface, InteractiveSurfaceButton, interactiveSurfaceVariants };
