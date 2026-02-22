import { useState, useRef, useEffect, useLayoutEffect, type RefObject } from "react";
import { ArrowLeft, Check, Loader2, Plus, Search, X } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import type { Measurable } from "@radix-ui/rect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TAG_COLORS, type TagColor, useTagColors } from "@/lib/tagColors";

const MAX_PROJECT_TAGS = 12;
const MAX_TAG_LENGTH = 32;

function normalizeTag(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase();
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

function areTagListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, index) => tag === b[index]);
}

// ─── Tag chip (coloured rectangle, like Trello) ──────────────────────────────

interface TagChipProps {
  tag: string;
  color: TagColor;
  onClick?: () => void;
  className?: string;
}

export function TagChip({ tag, color, onClick, className }: TagChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded px-2.5 py-1 text-xs font-medium transition-opacity",
        onClick ? "cursor-pointer hover:opacity-90 active:scale-[0.97]" : "cursor-default",
        className,
      )}
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {tag}
    </button>
  );
}

// ─── Color swatch grid ───────────────────────────────────────────────────────

function ColorSwatches({
  selectedId,
  onSelect,
}: {
  selectedId: string | undefined;
  onSelect: (colorId: string) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          onClick={() => onSelect(c.id)}
          className={cn(
            "h-7 w-full rounded transition-transform hover:scale-110 active:scale-100",
            selectedId === c.id && "ring-2 ring-offset-1 ring-foreground/50",
          )}
          style={{ backgroundColor: c.bg }}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ProjectTagsPopoverProps {
  /** Controlled open state – managed by the parent */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional virtual anchor (e.g. actions trigger) */
  anchorVirtualRef?: RefObject<Measurable>;
  sideOffset?: number;
  suppressInitialOutsideInteraction?: boolean;
  /** The element to anchor the popover to (tags area on the card) */
  children: React.ReactNode;
  projectTags: string[];
  availableTags: string[];
  isSaving: boolean;
  onCommitTags: (tags: string[]) => void;
}

type View = { type: "list" } | { type: "edit"; tag: string };

export function ProjectTagsPopover({
  open,
  onOpenChange,
  anchorVirtualRef,
  sideOffset = 6,
  suppressInitialOutsideInteraction = false,
  children,
  projectTags,
  availableTags,
  isSaving,
  onCommitTags,
}: ProjectTagsPopoverProps) {
  const [view, setView] = useState<View>({ type: "list" });
  const [search, setSearch] = useState("");
  const [draftTag, setDraftTag] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [draftProjectTags, setDraftProjectTags] = useState<string[]>(() =>
    dedupeTags(projectTags),
  );
  const createInputRef = useRef<HTMLInputElement>(null);
  const suppressOutsideRef = useRef(false);

  const { colorMap, setTagColor, getColor } = useTagColors();

  useEffect(() => {
    if (showCreate) setTimeout(() => createInputRef.current?.focus(), 50);
  }, [showCreate]);

  useLayoutEffect(() => {
    if (!open || !suppressInitialOutsideInteraction) return;
    suppressOutsideRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      suppressOutsideRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, suppressInitialOutsideInteraction]);

  const allTags = Array.from(new Set([...availableTags, ...draftProjectTags])).sort(
    (a, b) => a.localeCompare(b),
  );
  const filteredTags = allTags.filter((t) =>
    t.includes(search.toLowerCase().trim()),
  );

  const handleCreate = () => {
    const normalized = normalizeTag(draftTag);
    if (!normalized || normalized.length > MAX_TAG_LENGTH) return;
    if (draftProjectTags.length >= MAX_PROJECT_TAGS) return;
    setDraftProjectTags((current) => (
      current.includes(normalized) ? current : [...current, normalized]
    ));
    setDraftTag("");
    setShowCreate(false);
  };

  const resetPopoverState = () => {
    setView({ type: "list" });
    setSearch("");
    setDraftTag("");
    setShowCreate(false);
  };

  const closePopoverWithoutSaving = () => {
    resetPopoverState();
    onOpenChange(false);
  };

  const confirmPopoverChanges = () => {
    const normalizedDraftTags = dedupeTags(draftProjectTags);
    const normalizedProjectTags = dedupeTags(projectTags);
    if (!areTagListsEqual(normalizedDraftTags, normalizedProjectTags)) {
      onCommitTags(normalizedDraftTags);
    }
    resetPopoverState();
    onOpenChange(false);
  };

  const handlePopoverOpenChange = (nextOpen: boolean) => {
    if (nextOpen === open) return;
    if (!nextOpen) {
      closePopoverWithoutSaving();
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handlePopoverOpenChange}>
      {anchorVirtualRef ? (
        <>
          <PopoverAnchor virtualRef={anchorVirtualRef} />
          {children}
        </>
      ) : (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      )}

      <PopoverContent
        className="w-[280px] p-0 overflow-hidden"
        align="start"
        sideOffset={sideOffset}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onInteractOutside={(event) => {
          if (suppressOutsideRef.current) {
            event.preventDefault();
          }
        }}
      >
        {view.type === "edit" ? (
          // ── Edit label view ────────────────────────────────────────────────
          <>
            <div className="flex items-center gap-1 border-b px-2 py-2.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setView({ type: "list" })}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="flex-1 text-center text-sm font-medium">Edit label</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={closePopoverWithoutSaving}
                aria-label="Close labels popover"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 space-y-3">
              <div className="flex justify-center">
                <TagChip
                  tag={view.tag}
                  color={getColor(view.tag)}
                  className="pointer-events-none px-6 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Select a color</p>
                <ColorSwatches
                  selectedId={colorMap[view.tag]}
                  onSelect={(colorId) => setTagColor(view.tag, colorId)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setView({ type: "list" })}
              >
                Done
              </Button>
            </div>
          </>
        ) : (
          // ── Label list view ────────────────────────────────────────────────
          <>
            <div className="flex items-center gap-1 border-b px-3 py-2.5">
              <span className="flex-1 text-sm font-medium">Labels</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={closePopoverWithoutSaving}
                aria-label="Close labels popover"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="px-3 pt-2.5 pb-1.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search labels..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto px-2 pb-1">
              {filteredTags.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No labels yet
                </p>
              ) : (
                <div className="space-y-0.5">
                  {filteredTags.map((tag) => {
                    const active = draftProjectTags.includes(tag);
                    const color = getColor(tag);
                    return (
                      <div key={tag} className="group flex items-center gap-1 rounded py-0.5">
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left transition-opacity hover:opacity-90 active:scale-[0.98]"
                          style={{ backgroundColor: color.bg }}
                          onClick={() => {
                            setDraftProjectTags((current) =>
                              active
                                ? current.filter((value) => value !== tag)
                                : current.length >= MAX_PROJECT_TAGS
                                  ? current
                                  : [...current, tag],
                            );
                          }}
                          disabled={isSaving}
                          title={active ? `Remove "${tag}"` : `Add "${tag}"`}
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2 transition-all",
                              active ? "border-white bg-white" : "border-white/60",
                            )}
                          >
                            {active && (
                              <Check
                                className="h-3 w-3"
                                strokeWidth={3}
                                style={{ color: color.bg }}
                              />
                            )}
                          </span>
                          <span
                            className="truncate text-xs font-medium"
                            style={{ color: color.text }}
                          >
                            {tag}
                          </span>
                          {isSaving && (
                            <Loader2
                              className="ml-auto h-3 w-3 shrink-0 animate-spin"
                              style={{ color: color.text }}
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Edit label color"
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded",
                            "text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity",
                            "hover:bg-muted hover:text-foreground",
                          )}
                          onClick={() => setView({ type: "edit", tag })}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                          >
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t px-3 py-2.5 space-y-2">
              {showCreate ? (
                <div className="flex gap-1.5">
                  <Input
                    ref={createInputRef}
                    value={draftTag}
                    onChange={(e) => setDraftTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
                      if (e.key === "Escape") { e.preventDefault(); setShowCreate(false); setDraftTag(""); }
                    }}
                    placeholder="Label name…"
                    className="h-8 text-xs"
                    maxLength={MAX_TAG_LENGTH + 2}
                    disabled={draftProjectTags.length >= MAX_PROJECT_TAGS}
                  />
                  <Button
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={handleCreate}
                    disabled={!draftTag.trim() || draftProjectTags.length >= MAX_PROJECT_TAGS}
                  >
                    Add
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => { setShowCreate(false); setDraftTag(""); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setShowCreate(true)}
                  disabled={draftProjectTags.length >= MAX_PROJECT_TAGS}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create a new label
                </button>
              )}
            </div>

            <div className="border-t px-3 py-2.5">
              <Button
                size="sm"
                className="h-8 w-full text-xs"
                onClick={confirmPopoverChanges}
                disabled={isSaving}
              >
                OK
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
