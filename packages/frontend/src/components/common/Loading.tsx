import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  /** Optional message to display below the spinner */
  message?: string;
  /** Size of the spinner: "sm" | "md" | "lg" */
  size?: "sm" | "md" | "lg";
  /** Additional class names */
  className?: string;
}

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/**
 * Simple loading spinner with optional message.
 * Use for inline or contained loading states.
 */
export function LoadingSpinner({
  message,
  size = "md",
  className,
}: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 text-muted-foreground",
        className,
      )}
    >
      <Loader2 className={cn("animate-spin", sizeClasses[size])} />
      {message && <span className="text-sm">{message}</span>}
    </div>
  );
}

interface CenteredLoadingProps {
  /** Optional message to display */
  message?: string;
  /** Whether to fill the full screen height */
  fullScreen?: boolean;
}

/**
 * Centered loading state for pages or large containers.
 */
export function CenteredLoading({
  message = "Loading...",
  fullScreen = false,
}: CenteredLoadingProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center",
        fullScreen ? "h-screen" : "h-full min-h-[200px]",
      )}
    >
      <LoadingSpinner message={message} size="lg" />
    </div>
  );
}
