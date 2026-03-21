import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const HOST_VIEWPORT_INSET_CLASS =
  "flex h-full min-h-0 flex-1 flex-col bg-background px-1 pb-1 pt-0 md:px-1.5 md:pb-1.5 md:pt-0";

type FramedHostShellProps = {
  header?: ReactNode;
  children: ReactNode;
  background?: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  fullScreen?: boolean;
};

export function FramedHostShell({
  header,
  children,
  background,
  className,
  contentClassName,
  headerClassName,
  bodyClassName,
  fullScreen = false,
}: FramedHostShellProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col bg-background text-foreground",
        fullScreen && "h-dvh w-screen",
        className,
      )}
    >
      {background ? (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {background}
        </div>
      ) : null}

      <div
        className={cn(
          "relative z-10 flex min-h-0 flex-1 flex-col bg-background text-foreground",
          contentClassName,
        )}
      >
        {header ? (
          <div
            className={cn(
              "shrink-0 px-3 py-1 md:px-4",
              headerClassName,
            )}
          >
            {header}
          </div>
        ) : null}

        <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}

type FramedViewportProps = {
  children: ReactNode;
  className?: string;
};

export function FramedViewport({
  children,
  className,
}: FramedViewportProps) {
  return (
    <div
      className={cn(
        "relative flex h-full w-full min-h-0 flex-1 overflow-hidden rounded-[10px] border border-border/60 bg-background shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.18)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
