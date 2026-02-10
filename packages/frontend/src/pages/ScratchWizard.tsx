import {
  ScratchWizardProvider,
  useScratchWizard,
  ScratchHeader,
  ScratchPreview,
  ScratchForm,
} from "./scratch-wizard";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useState } from "react";

function ScratchWizardContent() {
  const { stylePreset } = useScratchWizard();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        {stylePreset && (
          <>
            <div
              className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full blur-3xl opacity-20 transition-all duration-1000"
              style={{ backgroundColor: stylePreset.palette[1] }}
            />
            <div
              className="absolute bottom-1/4 right-1/3 w-48 h-48 rounded-full blur-3xl opacity-10 transition-all duration-1000"
              style={{ backgroundColor: stylePreset.palette[2] }}
            />
          </>
        )}
      </div>

      <div className="relative z-10 flex h-dvh w-screen flex-col">
        {/* Header */}
        <ScratchHeader onOpenPreview={() => setPreviewOpen(true)} />

        {/* Main content */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Left side - Preview (desktop) */}
          <div className="hidden md:flex flex-[6] min-h-0 flex-col">
            <ScratchPreview />
          </div>

          {/* Right side - Form */}
          <ScratchForm />
        </div>
      </div>

      {/* Mobile preview */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="bottom" className="h-[85dvh] p-0 md:hidden">
          <div className="flex h-full flex-col">
            <div className="border-b bg-background px-4 py-3 pr-12">
              <div className="text-sm font-semibold">Preview</div>
              <div className="text-xs text-muted-foreground">
                Style idea based on your inputs
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ScratchPreview variant="sheet" />
            </div>
          </div>
        </SheetContent>
      </Sheet>
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
