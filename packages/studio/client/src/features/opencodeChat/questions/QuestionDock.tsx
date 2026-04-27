import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@vivd/ui";

import { cn } from "@/lib/utils";
import type {
  OpenCodeQuestionAnswer,
  OpenCodeQuestionRequest,
} from "../types";

type DraftState = {
  step: number;
  answers: OpenCodeQuestionAnswer[];
  customValues: string[];
  customEnabled: boolean[];
};

const draftCache = new Map<string, DraftState>();

function cloneAnswers(answers: OpenCodeQuestionAnswer[]): OpenCodeQuestionAnswer[] {
  return answers.map((answer) => [...answer]);
}

function readDraft(request: OpenCodeQuestionRequest): DraftState {
  const cached = draftCache.get(request.id);
  return {
    step: cached?.step ?? 0,
    answers: cached ? cloneAnswers(cached.answers) : [],
    customValues: cached?.customValues.map((value) => value ?? "") ?? [],
    customEnabled: cached?.customEnabled.map((value) => value === true) ?? [],
  };
}

function updateAnswerWithCustomValue(options: {
  answers: OpenCodeQuestionAnswer[];
  customValues: string[];
  customEnabled: boolean[];
  step: number;
  nextCustomValue: string;
  multiple: boolean;
}): OpenCodeQuestionAnswer[] {
  const { answers, customValues, customEnabled, step, nextCustomValue, multiple } =
    options;
  const trimmedPrevious = (customValues[step] ?? "").trim();
  const trimmedNext = nextCustomValue.trim();
  const isCustomEnabled = customEnabled[step] === true;
  const nextAnswers = cloneAnswers(answers);
  const current = nextAnswers[step] ?? [];

  if (!isCustomEnabled) {
    return nextAnswers;
  }

  if (multiple) {
    const withoutPrevious = trimmedPrevious
      ? current.filter((item) => item.trim() !== trimmedPrevious)
      : current;
    nextAnswers[step] = trimmedNext ? [...withoutPrevious, trimmedNext] : withoutPrevious;
    return nextAnswers;
  }

  nextAnswers[step] = trimmedNext ? [trimmedNext] : [];
  return nextAnswers;
}

interface QuestionDockProps {
  request: OpenCodeQuestionRequest;
  onReply: (
    requestId: string,
    answers: OpenCodeQuestionAnswer[],
  ) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
}

export function QuestionDock({
  request,
  onReply,
  onReject,
}: QuestionDockProps) {
  const [step, setStep] = useState(() => readDraft(request).step);
  const [answers, setAnswers] = useState<OpenCodeQuestionAnswer[]>(
    () => readDraft(request).answers,
  );
  const [customValues, setCustomValues] = useState<string[]>(
    () => readDraft(request).customValues,
  );
  const [customEnabled, setCustomEnabled] = useState<boolean[]>(
    () => readDraft(request).customEnabled,
  );
  const [submitting, setSubmitting] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    const draft = readDraft(request);
    setStep(draft.step);
    setAnswers(draft.answers);
    setCustomValues(draft.customValues);
    setCustomEnabled(draft.customEnabled);
    setSubmitting(false);
    completedRef.current = false;
  }, [request.id]);

  useEffect(() => {
    return () => {
      if (completedRef.current) {
        draftCache.delete(request.id);
        return;
      }

      draftCache.set(request.id, {
        step,
        answers: cloneAnswers(answers),
        customValues: customValues.map((value) => value ?? ""),
        customEnabled: customEnabled.map((value) => value === true),
      });
    };
  }, [answers, customEnabled, customValues, request.id, step]);

  const questions = request.questions ?? [];
  const total = questions.length;
  const question = questions[step];
  const options = question?.options ?? [];
  const multiple = question?.multiple === true;
  const allowCustom = question?.custom !== false;
  const currentAnswers = answers[step] ?? [];
  const currentCustomValue = customValues[step] ?? "";
  const isCustomSelected = customEnabled[step] === true;
  const canAdvance = currentAnswers.length > 0;

  const summary = useMemo(() => {
    const current = Math.min(step + 1, total || 1);
    return `${current} of ${Math.max(total, 1)} questions`;
  }, [step, total]);

  const updateCustomValue = (nextValue: string) => {
    setAnswers((previousAnswers) =>
      updateAnswerWithCustomValue({
        answers: previousAnswers,
        customValues,
        customEnabled,
        step,
        nextCustomValue: nextValue,
        multiple,
      }),
    );
    setCustomValues((previous) => {
      const next = [...previous];
      next[step] = nextValue;
      return next;
    });
  };

  const setSingleAnswer = (answer: string) => {
    setAnswers((previous) => {
      const next = cloneAnswers(previous);
      next[step] = [answer];
      return next;
    });
    setCustomEnabled((previous) => {
      const next = [...previous];
      next[step] = false;
      return next;
    });
  };

  const toggleMultiAnswer = (answer: string) => {
    setAnswers((previous) => {
      const next = cloneAnswers(previous);
      const current = next[step] ?? [];
      next[step] = current.includes(answer)
        ? current.filter((item) => item !== answer)
        : [...current, answer];
      return next;
    });
  };

  const toggleCustom = () => {
    if (!allowCustom || submitting) return;

    setCustomEnabled((previous) => {
      const next = [...previous];
      const nextValue = !(previous[step] === true);
      next[step] = nextValue;
      setAnswers((previousAnswers) =>
        updateAnswerWithCustomValue({
          answers: previousAnswers,
          customValues,
          customEnabled: next,
          step,
          nextCustomValue: currentCustomValue,
          multiple,
        }),
      );
      return next;
    });
  };

  const handleAdvance = async () => {
    if (!question || submitting || !canAdvance) return;

    if (step < total - 1) {
      setStep((current) => current + 1);
      return;
    }

    setSubmitting(true);
    try {
      await onReply(request.id, answers.map((answer) => [...answer]));
      completedRef.current = true;
      draftCache.delete(request.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onReject(request.id);
      completedRef.current = true;
      draftCache.delete(request.id);
    } finally {
      setSubmitting(false);
    }
  };

  if (!question) {
    return null;
  }

  return (
    <div className="relative mt-auto px-3 pb-3 pt-0 md:px-6 md:pb-6 md:pt-0">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-[1.4rem] border border-border/70 bg-background/95 px-4 py-4 shadow-2xl shadow-black/10 backdrop-blur-md supports-[backdrop-filter]:bg-background/82 dark:border-white/10 dark:shadow-black/45 md:px-5 md:py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Agent Question
              </div>
              <div className="text-base font-semibold text-foreground">{summary}</div>
              <div className="text-sm text-muted-foreground">
                Answer to let the run continue.
              </div>
            </div>
            <div className="flex items-center gap-1">
              {questions.map((item, index) => (
                <button
                  key={`${request.id}-step-${index}`}
                  type="button"
                  disabled={submitting}
                  onClick={() => setStep(index)}
                  className={cn(
                    "h-2.5 w-8 rounded-full transition-colors",
                    index === step ? "bg-primary" : "bg-muted",
                  )}
                  aria-label={item.header || `Question ${index + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="text-base font-semibold text-foreground">
              {question.header || `Question ${step + 1}`}
            </div>
            <div className="text-base leading-relaxed text-foreground">
              {question.question}
            </div>
            <div className="text-sm text-muted-foreground">
              {multiple ? "Choose one or more answers." : "Choose one answer."}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {options.map((option, index) => {
              const picked = currentAnswers.includes(option.label);
              return (
                <button
                  key={`${request.id}-option-${index}`}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (multiple) {
                      toggleMultiAnswer(option.label);
                      return;
                    }
                    setSingleAnswer(option.label);
                  }}
                  className={cn(
                    "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                    picked
                      ? "border-primary/60 bg-primary/10 shadow-sm"
                      : "border-border/70 bg-background/55 hover:border-primary/40 hover:bg-muted/45",
                  )}
                >
                  <div className="text-base font-medium text-foreground">{option.label}</div>
                  {option.description && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {option.description}
                    </div>
                  )}
                </button>
              );
            })}

            {allowCustom && (
              <div
                className={cn(
                  "rounded-xl border px-3 py-3 transition-colors",
                  isCustomSelected
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/70 bg-background/55 hover:border-primary/40",
                )}
              >
                <button
                  type="button"
                  disabled={submitting}
                  onClick={toggleCustom}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <div className="text-base font-medium text-foreground">Custom answer</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Type your own response instead of choosing a preset option.
                    </div>
                  </div>
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full border",
                      isCustomSelected ? "border-primary bg-primary" : "border-muted-foreground/40",
                    )}
                  />
                </button>
                <Input
                  value={currentCustomValue}
                  onChange={(event) => updateCustomValue(event.target.value)}
                  disabled={submitting || !isCustomSelected}
                  placeholder="Type your answer"
                  className="mt-3 text-base md:text-base"
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleReject}
              disabled={submitting}
            >
              Reject
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                disabled={submitting || step === 0}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void handleAdvance()}
                disabled={submitting || !canAdvance}
              >
                {submitting ? "Sending..." : step === total - 1 ? "Reply" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
