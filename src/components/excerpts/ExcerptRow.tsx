import type { ExcerptRow as Row } from "@/api/types";
import { useCodeTree } from "@/queries/codes";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { cn } from "@/lib/utils";

interface Props {
  row: Row;
  selected: boolean;
  onOpen: () => void;
  /** Checkbox click; `shiftKey` extends the selection from the last click. */
  onToggle: (shiftKey: boolean) => void;
}

export function ExcerptRow({ row, selected, onOpen, onToggle }: Props) {
  const tree = useCodeTree();
  return (
    <li className={cn("flex items-start gap-2 pl-3", selected && "bg-accent/10")}>
      <input
        type="checkbox"
        className="mt-3.5"
        checked={selected}
        // Click, not change: only a MouseEvent carries the Shift modifier.
        onClick={(e) => onToggle(e.shiftKey)}
        onChange={() => {}}
        aria-label={`Select excerpt from ${row.documentName}`}
        data-testid="excerpt-select"
      />
      <button
        className="flex min-w-0 flex-1 flex-col gap-1 py-2.5 pr-4 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        onClick={onOpen}
        data-testid="excerpt-row"
      >
        <p className="font-serif text-[15px] leading-snug">
          <span className="text-fg-muted">{row.contextBefore.slice(-80)}</span>
          <span className="font-medium">{row.snapshot}</span>
          <span className="text-fg-muted">{row.contextAfter.slice(0, 80)}</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>{row.documentName}</span>
          {row.codeIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1">
              <ColorDot color={tree.byId.get(id)?.code.color ?? "#999"} />
              {pathOf(tree, id)}
            </span>
          ))}
          {row.memoCount ? (
            <span>
              {row.memoCount} memo{row.memoCount > 1 ? "s" : ""}
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}
