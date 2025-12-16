import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CreateFolderInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}

export function CreateFolderInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  isPending,
}: CreateFolderInputProps) {
  return (
    <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
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
