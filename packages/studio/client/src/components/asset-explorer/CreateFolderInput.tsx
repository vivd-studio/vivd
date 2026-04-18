import { Input, Button } from "@vivd/ui";


interface CreateFolderInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  parentPath?: string | null;
}

export function CreateFolderInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  isPending,
  parentPath,
}: CreateFolderInputProps) {
  return (
    <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
      {parentPath && (
        <span className="text-xs text-muted-foreground shrink-0">
          in {parentPath}/
        </span>
      )}
      <Input
        placeholder="Folder name..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        autoFocus
      />
      <Button
        size="sm"
        onClick={onSubmit}
        disabled={!value.trim() || isPending}
      >
        Create
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
