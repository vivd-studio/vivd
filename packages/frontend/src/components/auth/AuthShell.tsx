import type { ReactNode } from "react";

import { VivdIcon } from "@/components/common";
import { cn } from "@/lib/utils";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
  /** @deprecated retained for compatibility; the shell no longer wraps content in a panel. */
  panelClassName?: string;
};

const authSteps = [
  {
    label: "Create",
    text: "Start from a project, not from scattered setup screens.",
  },
  {
    label: "Edit",
    text: "Open Studio when the site needs content, structure, or polish.",
  },
  {
    label: "Publish",
    text: "Ship a prepared version to the right domain from the same workspace.",
  },
];

function BrandMark({ size = "default" }: { size?: "default" | "lg" }) {
  const isLg = size === "lg";
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-border/80 bg-surface-panel shadow-[0_1px_0_0_hsl(var(--foreground)/0.04)]",
          isLg ? "size-11" : "size-9",
        )}
      >
        <VivdIcon
          className={cn(isLg ? "size-6" : "size-5")}
          strokeWidth={12}
        />
      </div>
      <div className="leading-tight">
        <div
          className={cn(
            "font-semibold tracking-tight",
            isLg ? "text-base" : "text-sm",
          )}
        >
          vivd
        </div>
        <div className="text-xs text-muted-foreground">Website workspace</div>
      </div>
    </div>
  );
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  contentClassName,
}: AuthShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-surface-page text-foreground">
      {/* ── Full-bleed marketing-side background (left half on lg+) ── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden bg-surface-panel lg:block lg:right-1/2"
      />
      {/* Brand bloom — sage primary fading toward honey accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden lg:block lg:right-1/2"
        style={{
          background:
            "radial-gradient(50% 55% at 25% 100%, hsl(var(--primary) / 0.18) 0%, transparent 65%), radial-gradient(45% 50% at 80% 0%, hsl(var(--chart-2) / 0.12) 0%, transparent 70%)",
        }}
      />
      {/* Hairline grid texture, very subtle, masked to a soft ellipse */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden opacity-[0.32] [background-image:linear-gradient(hsl(var(--border)/0.6)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.6)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_60%_70%_at_30%_50%,black_20%,transparent_80%)] lg:block lg:right-1/2"
      />
      {/* Hairline seam at the half-divide */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 hidden w-px bg-border/70 lg:block"
      />

      {/* Mobile-only bloom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 lg:hidden"
        style={{
          background:
            "radial-gradient(70% 60% at 100% 0%, hsl(var(--primary) / 0.10) 0%, transparent 60%)",
        }}
      />

      {/* ── Capped 50/50 content grid ── */}
      <div className="relative mx-auto grid min-h-screen w-full max-w-[78rem] lg:grid-cols-2">
        {/* Marketing column */}
        <aside className="hidden min-h-screen flex-col px-10 py-14 lg:flex">
          <div className="w-full max-w-[26rem]">
            <BrandMark size="lg" />
          </div>

          <div className="flex flex-1 items-center">
            <div className="w-full max-w-[26rem] space-y-10">
              <div className="space-y-5">
                <h2 className="text-[2.4rem] font-semibold leading-[1.05] tracking-[-0.035em]">
                  Build, edit, and publish — without the handoff.
                </h2>
                <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
                  The control plane, runtime, and publishing flow — one
                  workspace.
                </p>
              </div>

              <ol className="relative space-y-6 border-l border-border/70 pl-6">
                {authSteps.map((step, index) => (
                  <li key={step.label} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[1.625rem] top-[0.35rem] flex size-3 items-center justify-center rounded-full border border-border bg-surface-panel"
                    >
                      <span className="size-1.5 rounded-full bg-primary/70" />
                    </span>
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[0.7rem] font-medium tabular-nums text-muted-foreground/80">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm font-semibold tracking-tight">
                        {step.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {step.text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </aside>

        {/* Form column */}
        <section className="relative flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
          <div className={cn("w-full max-w-[24rem]", contentClassName)}>
            <div className="mb-10 lg:hidden">
              <BrandMark />
            </div>

            <header className="mb-8 space-y-2">
              <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.025em]">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </header>

            {children}

            {footer ? (
              <div className="mt-10 border-t border-border/70 pt-6 text-center text-xs text-muted-foreground">
                {footer}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
