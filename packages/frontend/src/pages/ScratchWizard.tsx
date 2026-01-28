import {
  ScratchWizardProvider,
  useScratchWizard,
  ScratchHeader,
  ScratchPreview,
  ScratchForm,
} from "./scratch-wizard";

function ScratchWizardContent() {
  const { stylePreset } = useScratchWizard();

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

      {/* Header */}
      <ScratchHeader />

      {/* Main content */}
      <div className="relative z-10 flex h-[calc(100vh-65px)]">
        {/* Left side - Preview */}
        <div className="flex-[6] flex flex-col">
          <ScratchPreview />
        </div>

        {/* Right side - Form */}
        <ScratchForm />
      </div>
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
