export function RouteLoadingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-0 z-[80]"
    >
      <div className="h-0.5 w-full overflow-hidden bg-primary/15">
        <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-primary/90 to-transparent" />
      </div>
      <span className="sr-only">Loading page</span>
    </div>
  );
}
