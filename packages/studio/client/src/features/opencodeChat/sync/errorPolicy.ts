import { normalizeErrorMessage } from "../../../components/chat/chatStreamUtils";

export type SanitizedSessionError = {
  type: string;
  message: string;
  attempt?: number;
  nextRetryAt?: number;
};

const PROVIDER_CAPACITY_PATTERN =
  /requires more credits|can only afford|insufficient credits|openrouter\.ai\/settings\/credits|max tokens/i;

export function sanitizeSessionError(input: {
  type: string;
  message?: unknown;
  attempt?: number;
  nextRetryAt?: number;
}): SanitizedSessionError {
  const rawMessage =
    normalizeErrorMessage(input.message) ||
    "Something went wrong while running this task.";

  if (input.type === "load") {
    return {
      type: "load",
      message: "We couldn't load this chat session. Please try again.",
      attempt: input.attempt,
      nextRetryAt: input.nextRetryAt,
    };
  }

  if (input.type === "stream") {
    return {
      type: "stream",
      message: "Live updates were interrupted. Please try again.",
      attempt: input.attempt,
      nextRetryAt: input.nextRetryAt,
    };
  }

  if (input.type === "retry") {
    return {
      type: "retry",
      message: "The agent hit a temporary issue and is retrying.",
      attempt: input.attempt,
      nextRetryAt: input.nextRetryAt,
    };
  }

  if (PROVIDER_CAPACITY_PATTERN.test(rawMessage)) {
    return {
      type: "provider_limit",
      message:
        "The agent could not finish this task because of a temporary provider limit. Please try again.",
      attempt: input.attempt,
      nextRetryAt: input.nextRetryAt,
    };
  }

  return {
    type: input.type || "task",
    message: "Something went wrong while running this task. Please try again.",
    attempt: input.attempt,
    nextRetryAt: input.nextRetryAt,
  };
}
