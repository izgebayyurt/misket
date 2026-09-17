import type { ExcerptRow as Row } from "@/api/types";
import { useCodeTree } from "@/queries/codes";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { cn } from "@/lib/utils";
import { RegionThumbnail } from "./RegionThumbnail";

interface Props {
  row: Row;
  selected?: boolean;
  /** The row push-down review is pointed at, highlighted like a cursor. */
  active?: boolean;
  onOpen: () => void;
  /**
   * Checkbox click; `shiftKey` extends the selection from the last click.
   * Omitted where there is nothing to select — the framework matrix's
   * evidence drawer shows the same rows, read-only.
   */
  onToggle?: (shiftKey: boolean) => void;
}

export function ExcerptRow({ row, selected = false, active, onOpen, onToggle }: Props) {
  const tree = useCodeTree();
  const isRegion = row.kind === "image_region";
  return (
    <li
      className={cn(
        "flex items-start gap-2 pl-3",
        selected && "bg-accent/10",
        active && "bg-muted ring-2 ring-inset ring-focus",
      )}
      aria-current={active ? "true" : undefined}
    >
      {onToggle ? (
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
      ) : null}
      <button
        className="flex min-w-0 flex-1 gap-3 py-2.5 pr-4 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        onClick={onOpen}
        data-testid="excerpt-row"
      >
        {isRegion ? (
          <RegionThumbnail
            documentId={row.documentId}
            geometry={row.geometry}
            width={96}
            height={64}
          />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          {isRegion ? (
            <span className="block text-[13px] text-fg-muted">{row.snapshot}</span>
          ) : (
            <span className="block font-serif text-[15px] leading-snug">
              <span className="text-fg-muted">{row.contextBefore.slice(-80)}</span>
              <span className="font-medium">{row.snapshot}</span>
              <span className="text-fg-muted">{row.contextAfter.slice(0, 80)}</span>
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span>{row.documentName}</span>
            {row.speaker ? (
              <span
                className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-fg"
                title={`Spoken by ${row.speaker}`}
                data-testid="excerpt-speaker"
              >
                {row.speaker}
              </span>
            ) : null}
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
          </span>
        </span>
      </button>
    </li>
  );
}
