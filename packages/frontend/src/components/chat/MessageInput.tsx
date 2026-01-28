import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { useRef, useEffect } from "react";

interface MessageInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
}

export function MessageInput({
  input,
  setInput,
  onSend,
  isLoading,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Reset height when input is cleared
  useEffect(() => {
    if (input === "" && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

  return (
    <div className="p-4 border-t mt-auto">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none max-h-[200px]"
          placeholder="Type a task..."
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={1}
        />
        <Button
          onClick={onSend}
          disabled={isLoading || !input.trim()}
          size="icon"
          className="h-10 w-10 shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
