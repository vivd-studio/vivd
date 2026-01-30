import { PreviewProvider, PreviewContent } from "@/components/preview";
import { Toaster } from "@/components/ui/sonner";

export function App() {
  return (
    <>
      <PreviewProvider
        url={null}
        originalUrl={null}
        projectSlug="studio"
        version={1}
        onClose={() => {}}
        embedded={false}
      >
        <PreviewContent />
      </PreviewProvider>
      <Toaster />
    </>
  );
}
