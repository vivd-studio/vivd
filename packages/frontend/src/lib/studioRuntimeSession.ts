type RuntimeWithOrigins = {
  url: string | null;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
};

export function readStudioRuntimeOrigins(runtime: RuntimeWithOrigins): {
  runtimeUrl: string | null;
  compatibilityUrl: string | null;
} {
  return {
    runtimeUrl: runtime.runtimeUrl ?? runtime.url ?? null,
    compatibilityUrl: runtime.compatibilityUrl ?? null,
  };
}
