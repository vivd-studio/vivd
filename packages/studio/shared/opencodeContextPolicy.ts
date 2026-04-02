export const DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS = 200_000;
export const STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS =
  DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;

export function resolveStudioWorkingContextLimit(options?: {
  contextLimit?: number;
  inputLimit?: number;
  softLimit?: number;
}): number {
  const softLimit =
    options?.softLimit ?? STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  const candidates = [
    softLimit,
    options?.contextLimit,
    options?.inputLimit,
  ].filter(isFinitePositiveNumber);

  if (candidates.length === 0) {
    return softLimit;
  }

  return Math.min(...candidates);
}

export function calculateStudioContextUsagePercentage(options: {
  totalTokens: number;
  contextLimit?: number;
  inputLimit?: number;
  softLimit?: number;
}): number | null {
  if (!isFinitePositiveNumber(options.totalTokens)) {
    return null;
  }

  const workingLimit = resolveStudioWorkingContextLimit(options);
  if (!isFinitePositiveNumber(workingLimit)) {
    return null;
  }

  return Math.round((options.totalTokens / workingLimit) * 100);
}

export function isStudioSoftContextLimitReached(options: {
  totalTokens: number;
  contextLimit?: number;
  inputLimit?: number;
  softLimit?: number;
}): boolean {
  if (!isFinitePositiveNumber(options.totalTokens)) {
    return false;
  }

  return (
    options.totalTokens >=
    resolveStudioWorkingContextLimit({
      contextLimit: options.contextLimit,
      inputLimit: options.inputLimit,
      softLimit: options.softLimit,
    })
  );
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
