import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SettingsPageShellProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SettingsPageShell({
  title,
  description,
  actions,
  children,
  className,
}: SettingsPageShellProps) {
  return (
    <div className={cn("w-full space-y-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Constrains form/settings content to a comfortable reading width.
 * Use inside tab content or card bodies — keeps tab bars and page headers full-width.
 */
export function FormContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl space-y-6", className)}>{children}</div>
  );
}
