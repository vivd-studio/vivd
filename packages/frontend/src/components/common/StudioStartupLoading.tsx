import { cn } from "@/lib/utils";

interface StudioStartupLoadingProps {
  fullScreen?: boolean;
  className?: string;
}

export function StudioStartupLoading({
  fullScreen = false,
  className,
}: StudioStartupLoadingProps) {
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden px-6",
        fullScreen ? "h-dvh w-screen" : "h-full min-h-0",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute h-72 w-72 rounded-full bg-primary/10 blur-3xl animate-pulse"
      />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-5 px-6 py-8 text-center">
        <div className="relative h-24 w-24">
          <div className="absolute inset-0 rounded-full border border-primary/20" />
          <div className="absolute inset-2 rounded-full border-2 border-primary/70 border-t-transparent animate-spin [animation-duration:1.1s]" />
          <div className="absolute inset-5 rounded-full border-2 border-primary/35 border-b-transparent animate-spin [animation-direction:reverse] [animation-duration:1.6s]" />
          <div className="absolute inset-8 rounded-full bg-primary/80 shadow-lg shadow-primary/40 animate-pulse" />
        </div>

        <div className="space-y-1.5">
          <p className="text-base font-semibold tracking-tight">Booting studio</p>
          <p className="text-sm text-muted-foreground">
            Preparing your editor and dev server.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
          <span>This can take a while on first startup.</span>
        </div>
      </div>
    </div>
  );
}
