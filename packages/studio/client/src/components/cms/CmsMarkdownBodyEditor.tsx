import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { Loader2, FileText } from "lucide-react";
import { useMemo } from "react";
import { useTheme } from "@/components/theme";
import { Label } from "@/components/ui/label";

interface CmsMarkdownBodyEditorProps {
  value: string;
  readOnly?: boolean;
  loading?: boolean;
  onChange: (value: string) => void;
}

export function CmsMarkdownBodyEditor({
  value,
  readOnly = false,
  loading = false,
  onChange,
}: CmsMarkdownBodyEditorProps) {
  const { resolvedTheme } = useTheme();
  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping], []);

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <Label className="text-sm font-medium">Markdown body</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Long-form entry content stored in the markdown file body.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading markdown body…
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <CodeMirror
            value={value}
            onChange={onChange}
            extensions={extensions}
            editable={!readOnly}
            height="420px"
            theme={resolvedTheme}
            className="text-sm"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: true,
              dropCursor: false,
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
        </div>
      )}
    </div>
  );
}
