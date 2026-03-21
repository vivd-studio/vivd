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
      <div
        className="absolute -bottom-[20%] -left-[10%] h-[60%] w-[45%] rounded-full blur-[120px]"
        style={{ background: "hsl(var(--chart-1))" }}
      />
      <div
        className="absolute -bottom-[18%] -right-[10%] h-[55%] w-[42%] rounded-full blur-[120px]"
        style={{ background: "hsl(var(--chart-5))" }}
      />
      <div
        className="absolute -bottom-[25%] left-[25%] h-[50%] w-[50%] rounded-full blur-[120px]"
        style={{ background: "hsl(var(--chart-3))" }}
      />
      <div
        className="absolute bottom-[5%] left-[15%] h-[30%] w-[28%] rounded-full blur-[100px]"
        style={{ background: "hsl(var(--chart-4))" }}
      />
      <div
        className="absolute bottom-[8%] right-[12%] h-[28%] w-[30%] rounded-full blur-[100px]"
        style={{ background: "hsl(var(--chart-2))" }}
      />
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--background)) 15%, hsl(var(--background) / 0.92) 30%, hsl(var(--background) / 0.6) 50%, hsl(var(--background) / 0.2) 72%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--background)) 18%, hsl(var(--background) / 0.94) 32%, hsl(var(--background) / 0.6) 52%, hsl(var(--background) / 0.16) 74%, transparent 100%)",
        }}
      />
      <div className="absolute left-1/2 top-[14%] h-40 w-[32rem] -translate-x-1/2 rounded-full bg-white/14 blur-3xl dark:bg-white/3" />
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
