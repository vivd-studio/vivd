import * as React from "react";
import { cn } from "@/lib/utils";

type VivdIconProps = React.SVGProps<SVGSVGElement> & {
  title?: string;
};

export function VivdIcon({ className, title = "vivd", ...props }: VivdIconProps) {
  const iconId = React.useId().replace(/:/g, "");
  const gradientId = `vivd-icon-gradient-${iconId}`;

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--chart-2))" />
        </linearGradient>
      </defs>
      <path
        d="M25 30 L50 75 L75 30"
        stroke={`url(#${gradientId})`}
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
