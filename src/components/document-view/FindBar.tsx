import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  currentIndex: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/** A compact "find in document" bar docked at the top of the document view. */
export function FindBar({
  query,
  onQueryChange,
  currentIndex,
  total,
  onNext,
  onPrev,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className="flex items-center gap-1 border-b border-border bg-panel px-3 py-1.5"
      data-testid="find-bar"
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in document"
        className="h-7 max-w-64 text-sm"
        data-testid="find-input"
      />
      <span className="w-16 shrink-0 text-center text-xs text-fg-muted" data-testid="find-count">
        {total === 0 ? "0 of 0" : `${currentIndex + 1} of ${total}`}
      </span>
      <button
        type="button"
        className="rounded p-1 text-fg-muted hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={onPrev}
        disabled={total === 0}
        aria-label="Previous match"
        data-testid="find-prev"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        className="rounded p-1 text-fg-muted hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={onNext}
        disabled={total === 0}
        aria-label="Next match"
        data-testid="find-next"
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        className="ml-1 rounded p-1 text-fg-muted hover:bg-muted"
        onClick={onClose}
        aria-label="Close find bar"
        data-testid="find-close"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
