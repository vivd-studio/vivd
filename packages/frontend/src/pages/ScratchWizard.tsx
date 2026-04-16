import {
  ScratchWizardProvider,
  ScratchForm,
} from "./scratch-wizard";
import { NewProjectHeaderActions } from "@/components/projects";
import {
  FramedViewport,
  HOST_VIEWPORT_INSET_CLASS,
} from "@/components/common/FramedHostShell";

function ScratchBackdrop() {
  return (
    <>
      {/* Bloom blobs – 6 overlapping orbs flowing green → gold → coral → lavender → teal */}
      <div
        className="scratch-bloom-drift absolute -bottom-[20%] -left-[15%] h-[70%] w-[55%] rounded-full blur-[160px]"
        style={{ background: "hsl(var(--scratch-bloom-1))" }}
      />
      <div
        className="scratch-bloom-drift-alt absolute -bottom-[15%] left-[10%] h-[60%] w-[45%] rounded-full blur-[140px]"
        style={{ background: "hsl(var(--scratch-bloom-2))" }}
      />
      <div
        className="scratch-bloom-drift absolute -bottom-[22%] left-[25%] h-[65%] w-[50%] rounded-full blur-[160px]"
        style={{ background: "hsl(var(--scratch-bloom-3))" }}
      />
      <div
        className="scratch-bloom-drift-alt absolute -bottom-[18%] right-[15%] h-[58%] w-[48%] rounded-full blur-[140px]"
        style={{ background: "hsl(var(--scratch-bloom-4))" }}
      />
      <div
        className="scratch-bloom-drift absolute -bottom-[24%] -right-[12%] h-[68%] w-[52%] rounded-full blur-[160px]"
        style={{ background: "hsl(var(--scratch-bloom-5))" }}
      />
      <div
        className="scratch-bloom-drift-alt absolute -bottom-[12%] left-[35%] h-[45%] w-[40%] rounded-full blur-[120px]"
        style={{ background: "hsl(var(--scratch-bloom-6))" }}
      />

      {/* Light-mode fade: top stays clean, bottom blooms through */}
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--background)) 8%, hsl(var(--background) / 0.78) 22%, hsl(var(--background) / 0.38) 40%, hsl(var(--background) / 0.08) 60%, transparent 100%)",
        }}
      />
      {/* Dark-mode fade */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--background)) 10%, hsl(var(--background) / 0.82) 25%, hsl(var(--background) / 0.4) 42%, hsl(var(--background) / 0.06) 62%, transparent 100%)",
        }}
      />

      {/* Soft top glow for depth */}
      <div className="absolute left-1/2 top-[12%] h-48 w-[36rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl dark:bg-white/3" />
    </>
  );
}

function ScratchWizardContent() {
  return (
    <div className={HOST_VIEWPORT_INSET_CLASS}>
      <FramedViewport className="bg-background/54 backdrop-blur-xl">
        <div className="relative flex h-full w-full min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-10 pt-4 sm:px-6 sm:pb-14 sm:pt-6">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <ScratchBackdrop />
          </div>
          <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
            <NewProjectHeaderActions />
          </div>
          <div className="relative z-10 flex w-full items-center justify-center py-8 sm:py-10">
            <ScratchForm />
          </div>
        </div>
      </FramedViewport>
    </div>
  );
}

export default function ScratchWizard() {
  return (
    <ScratchWizardProvider>
      <ScratchWizardContent />
    </ScratchWizardProvider>
  );
}
