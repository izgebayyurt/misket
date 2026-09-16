import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  /** How many numbered paragraphs the document has. */
  total: number;
  /** Called with a 1-based paragraph number, already inside [1, total]. */
  onGo: (paragraph: number) => void;
  onClose: () => void;
}

/**
 * A compact "go to paragraph" bar docked at the top of the document view,
 * styled like the find bar. Enter jumps, Escape closes.
 */
export function GoToParagraphBar({ total, onGo, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= total;

  function submit() {
    if (!valid) return;
    onGo(parsed);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className="flex items-center gap-1 border-b border-border bg-panel px-3 py-1.5"
      data-testid="goto-bar"
    >
      <Input
        ref={inputRef}
        value={value}
        inputMode="numeric"
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={onKeyDown}
        placeholder="Go to paragraph"
        aria-label="Go to paragraph"
        className="h-7 max-w-40 text-sm"
        data-testid="goto-input"
      />
      <span className="shrink-0 text-xs text-fg-muted" data-testid="goto-total">
        of {total}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className="ml-1 rounded p-1 text-fg-muted hover:bg-muted"
        onClick={onClose}
        aria-label="Close go to paragraph"
        data-testid="goto-close"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
