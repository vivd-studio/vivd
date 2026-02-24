import { useEffect, useCallback, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LoadingSpinner } from "@/components/common";
import { Loader2, Save, X, FileCode, WrapText, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { useOptionalChatContext } from "@/components/chat/ChatContext";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";

interface TextEditorPanelProps {
  projectSlug: string;
  version: number;
  filePath: string;
  onClose: () => void;
  onSave?: () => void;
}

// Get CodeMirror language extension based on file extension
function getLanguageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "html":
    case "htm":
    case "astro":
    case "vue":
    case "svelte":
      return html();
    case "css":
    case "scss":
    case "sass":
    case "less":
      return css();
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "xml":
    case "svg":
    case "yaml":
    case "yml":
      return xml();
    default:
      return [];
  }
}

export function TextEditorPanel({
  projectSlug,
  version,
  filePath,
  onClose,
  onSave,
}: TextEditorPanelProps) {
  const [content, setContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [lineWrap, setLineWrap] = useState(true);
  const chatContext = useOptionalChatContext();

  const filename = filePath.split("/").pop() || filePath;

  const handleAddToChat = useCallback(() => {
    if (!chatContext) return;
    chatContext.addAttachedFile({
      path: filePath,
      filename: filename,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    });
    toast.success(`Added ${filename} to chat`);
  }, [chatContext, filePath, filename]);

  // Query to load file content
  const { data, isLoading, error } = trpc.assets.readTextFile.useQuery(
    {
      slug: projectSlug,
      version,
      relativePath: filePath,
    },
    {
      refetchOnWindowFocus: false,
    }
  );

  // Mutation to save file
  const saveMutation = trpc.assets.saveTextFile.useMutation({
    onSuccess: () => {
      toast.success("File saved");
      setHasChanges(false);
      onSave?.();
    },
    onError: (error) => {
      toast.error("Failed to save file", { description: error.message });
    },
  });

  // Initialize content when data loads
  useEffect(() => {
    if (data?.content) {
      setContent(data.content);
      setHasChanges(false);
    }
  }, [data?.content]);

  // Handle content changes
  const handleChange = useCallback((value: string) => {
    setContent(value);
    setHasChanges(true);
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    saveMutation.mutate({
      slug: projectSlug,
      version,
      relativePath: filePath,
      content,
    });
  }, [projectSlug, version, filePath, content, saveMutation]);

  // Handle close with unsaved changes warning
  const handleClose = useCallback(() => {
    if (hasChanges) {
      const confirmClose = window.confirm(
        "You have unsaved changes. Are you sure you want to close?"
      );
      if (!confirmClose) return;
    }
    onClose();
  }, [hasChanges, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S to save
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges && !saveMutation.isPending) {
          handleSave();
        }
      }
      // Escape to close
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleClose, hasChanges, saveMutation.isPending]);

  const languageExtension = getLanguageExtension(filename);

  // Build extensions array with optional line wrapping
  const extensions = useMemo(() => {
    const exts: Extension[] = [languageExtension];
    if (lineWrap) {
      exts.push(EditorView.lineWrapping);
    }
    return exts;
  }, [languageExtension, lineWrap]);

  return (
    <div className="absolute inset-0 z-10 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <FileCode className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold truncate" title={filename}>{filename}</h2>
            <p className="text-xs text-muted-foreground truncate" title={filePath}>{filePath}</p>
          </div>
          {hasChanges && (
            <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full shrink-0">
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={lineWrap ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setLineWrap((prev) => !prev)}
                className="h-8 w-8 p-0"
              >
                <WrapText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {lineWrap ? "Disable line wrap" : "Enable line wrap"}
            </TooltipContent>
          </Tooltip>

          {chatContext && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddToChat}
                  className="h-8 w-8 p-0"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add to Chat</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
                className="h-8 w-8 p-0"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {saveMutation.isPending
                ? "Saving..."
                : hasChanges
                ? "Save (⌘S)"
                : "No changes"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={saveMutation.isPending}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <LoadingSpinner message="Loading file..." size="lg" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-destructive">
              <p className="text-sm">Failed to load file</p>
              <p className="text-xs text-muted-foreground">{error.message}</p>
            </div>
          </div>
        ) : (
          <CodeMirror
            value={content}
            onChange={handleChange}
            extensions={extensions}
            height="100%"
            theme="dark"
            className="h-full text-sm"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              rectangularSelection: true,
              crosshairCursor: false,
              highlightSelectionMatches: true,
              closeBracketsKeymap: true,
              searchKeymap: true,
              foldKeymap: true,
              completionKeymap: true,
              lintKeymap: true,
            }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>Press Cmd+S to save, Escape to close</span>
        <span>{content.split("\n").length} lines</span>
      </div>
    </div>
  );
}
