import type { ExcerptRow as Row } from "@/api/types";
import { useCodeTree } from "@/queries/codes";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { RegionThumbnail } from "./RegionThumbnail";

export function ExcerptRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const tree = useCodeTree();
  const isRegion = row.kind === "image_region";
  return (
    <li>
      <button
        className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
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
