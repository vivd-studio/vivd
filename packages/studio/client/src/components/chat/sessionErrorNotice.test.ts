import { describe, expect, it } from "vitest";
import { buildSessionErrorNotice } from "./sessionErrorNotice";

describe("sessionErrorNotice", () => {
  it("formats retry notices with countdown and attempt info", () => {
    const notice = buildSessionErrorNotice(
      {
        type: "retry",
        message: "The agent hit a temporary issue and is retrying.",
        attempt: 5,
        nextRetryAt: 14_000,
      },
      10_000,
    );

    expect(notice).toEqual({
      title: "The agent hit a temporary issue and is retrying.",
      detail: "Retrying automatically in 4s • Attempt 5",
      tone: "warning",
      showSpinner: true,
    });
  });

  it("keeps stream interruptions compact and non-fatal looking", () => {
    const notice = buildSessionErrorNotice({
      type: "stream",
      message: "Live updates were interrupted. Please try again.",
    });

    expect(notice).toEqual({
      title: "Live updates were interrupted. Please try again.",
      detail: undefined,
      tone: "warning",
      showSpinner: false,
    });
  });

  it("preserves destructive treatment for non-retry task failures", () => {
    const notice = buildSessionErrorNotice({
      type: "task",
      message: "Something went wrong while running this task. Please try again.",
      attempt: 2,
    });

    expect(notice).toEqual({
      title: "Something went wrong while running this task. Please try again.",
      detail: "Attempt 2",
      tone: "destructive",
      showSpinner: false,
    });
  });
});
