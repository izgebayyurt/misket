import { Tag } from "lucide-react";
import { describe } from "@/core/keymap";

interface Props {
  pos: { top: number; left: number };
  onCode: () => void;
}

/** A small floating action anchored below the end of the current selection. */
export function SelectionToolbar({ pos, onCode }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="absolute z-20 flex items-center gap-1 rounded-md border border-border bg-panel p-0.5 shadow-md"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
      data-testid="selection-toolbar"
    >
      <button
        type="button"
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-muted"
        onClick={onCode}
      >
        <Tag className="size-3.5" /> Code
        <kbd className="ml-1 text-fg-muted">{describe("palette")}</kbd>
      </button>
    </div>
  );
}
