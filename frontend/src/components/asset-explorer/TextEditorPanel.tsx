import { useEffect, useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, Save, X, FileCode } from "lucide-react";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
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

  const filename = filePath.split("/").pop() || filePath;
  const languageExtension = getLanguageExtension(filename);

  return (
    <div className="absolute inset-0 z-10 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <FileCode className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">{filename}</h2>
            <p className="text-xs text-muted-foreground">{filePath}</p>
          </div>
          {hasChanges && (
            <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full">
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={saveMutation.isPending}
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" />
                Save
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading file...
              </span>
            </div>
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
            extensions={[languageExtension]}
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
