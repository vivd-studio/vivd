import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@vivd/ui";

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
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>{title}</PageTitle>
          <PageDescription>{description}</PageDescription>
        </PageHeaderContent>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </PageHeader>
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
