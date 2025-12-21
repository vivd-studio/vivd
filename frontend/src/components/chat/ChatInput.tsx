import { Button } from "@/components/ui/button";
import { ElementSelector } from "./ElementSelector";
import { SelectedElementPill } from "./SelectedElementPill";
import { useChatContext } from "./ChatContext";

export function ChatInput() {
  const {
    input,
    setInput,
    handleSend,
    attachedElement,
    setAttachedElement,
    selectorMode,
    setSelectorMode,
    isLoading,
  } = useChatContext();

  return (
    <div className="p-4 border-t mt-auto">
      {/* Show attached element pill above input */}
      {attachedElement && (
        <div className="mb-2">
          <SelectedElementPill
            selector={attachedElement.selector}
            description={attachedElement.description}
            onRemove={() => setAttachedElement(null)}
          />
        </div>
      )}
      <div className="flex gap-2 items-end">
        {setSelectorMode && (
          <ElementSelector
            isActive={selectorMode}
            onToggle={() => setSelectorMode(!selectorMode)}
            disabled={isLoading}
          />
        )}
        <div className="flex-1 flex gap-2 items-end">
          <textarea
            className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none max-h-[200px]"
            placeholder={
              selectorMode
                ? "Click an element in the preview..."
                : attachedElement
                ? "Describe what you want to change..."
                : "Type a task..."
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isLoading}
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={isLoading || (!input.trim() && !attachedElement)}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
