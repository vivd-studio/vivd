import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ChatPanel } from "./ChatSidepanel";

interface PreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
}

export function PreviewModal({
  open,
  onOpenChange,
  url,
  originalUrl,
  projectSlug,
  version,
}: PreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!url) return null;

  // Ensure we have a full URL
  const fullUrl =
    url.startsWith("http") || url.startsWith("/api") ? url : `/api${url}`;

  const handleCopy = () => {
    const absoluteUrl = fullUrl.startsWith("http")
      ? fullUrl
      : `${window.location.origin}${fullUrl}`;

    navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTaskComplete = () => {
    // Refresh the iframe
    setRefreshKey((prev) => prev + 1);
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b flex flex-row items-center gap-4 space-y-0 shrink-0 z-10 bg-background">
          <DialogTitle>Preview</DialogTitle>
          <div className="flex items-center gap-2 ml-auto mr-4 md:mr-12 overflow-x-auto max-w-full">
            {originalUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(originalUrl, "_blank")}
                className="text-muted-foreground"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Original Website
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              title="Refresh Preview"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <Check className="w-4 h-4 mr-2" />
              ) : (
                <Copy className="w-4 h-4 mr-2" />
              )}
              {copied ? "Copied" : "Copy preview link"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(fullUrl, "_blank")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Page
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 relative">
          <div className="flex-1 relative bg-muted/20">
            <iframe
              key={refreshKey}
              src={fullUrl}
              className="w-full h-full border-0"
              title="Preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              onLoad={(e) => {
                const iframe = e.currentTarget;
                try {
                  const doc = iframe.contentDocument;
                  if (doc) {
                    const style = doc.createElement("style");
                    style.textContent = `
                                            /* Fix position:fixed elements to be relative to iframe, not viewport */
                                            html {
                                                transform: translateZ(0);
                                            }
                                            ::-webkit-scrollbar {
                                                width: 14px;
                                                height: 14px;
                                            }
                                            ::-webkit-scrollbar-track {
                                                background: transparent;
                                            }
                                            ::-webkit-scrollbar-thumb {
                                                background-color: rgba(156, 163, 175, 0.5);
                                                border-radius: 5px;
                                                border: 2px solid transparent;
                                                background-clip: content-box;
                                            }
                                            ::-webkit-scrollbar-thumb:hover {
                                                background-color: rgba(156, 163, 175, 0.8);
                                            }
                                        `;
                    doc.head.appendChild(style);
                  }
                } catch (err) {
                  console.warn("Could not inject styles into iframe", err);
                }
              }}
            />

            {/* Floating Chat Button */}
            {projectSlug && !chatOpen && (
              <Button
                className="absolute bottom-8 right-8 rounded-full h-14 w-14 shadow-lg p-0 bg-gradient-to-br from-indigo-600 to-violet-600 animate-bop animate-pulse-outline hover:from-indigo-500 hover:to-violet-500 border-none"
                onClick={() => setChatOpen(true)}
              >
                <img
                  src="/favicon-transparent.svg"
                  alt="App Logo"
                  className="w-10 h-10"
                />
              </Button>
            )}
          </div>

          {/* Chat Panel - Pushes iframe when open */}
          {projectSlug && chatOpen && (
            <div className="w-[400px] border-l bg-background flex flex-col h-full shadow-xl z-20 transition-all">
              <ChatPanel
                key={`${projectSlug}-${version}`}
                projectSlug={projectSlug}
                version={version}
                onTaskComplete={handleTaskComplete}
                onClose={() => setChatOpen(false)}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
