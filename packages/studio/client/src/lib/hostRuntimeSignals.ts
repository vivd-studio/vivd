import { postVivdHostMessage } from "@/lib/hostBridge";

const TRANSPORT_DEGRADED_COOLDOWN_MS = 5_000;

let lastTransportDegradedAt = 0;

type StudioTransportDegradedSignal = {
  transport: "trpc-http";
  reason: "network-error" | "timeout";
};

export function reportVivdStudioTransportDegraded(
  signal: StudioTransportDegradedSignal,
): boolean {
  if (window.parent === window) return false;

  const now = Date.now();
  if (now - lastTransportDegradedAt < TRANSPORT_DEGRADED_COOLDOWN_MS) {
    return false;
  }

  lastTransportDegradedAt = now;
  postVivdHostMessage({
    type: "vivd:studio:transport-degraded",
    transport: signal.transport,
    reason: signal.reason,
  });
  return true;
}

export function resetVivdStudioTransportDegradedSignalForTests(): void {
  lastTransportDegradedAt = 0;
}
