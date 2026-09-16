import { X } from "lucide-react";
import { useExcerptDetail, useRemoveExcerptCode } from "@/queries/excerpts";
import { useCodeTree } from "@/queries/codes";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { UseAsExampleButton } from "@/components/codebook/UseAsExampleButton";
import { Button } from "@/components/ui/button";
import { MemoList } from "@/components/memos/MemoList";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { RegionThumbnail } from "./RegionThumbnail";

/** Right-panel view of the focused excerpt: context, codes, memos. */
export function ExcerptInspector({ excerptId }: { excerptId: string }) {
  const { data: detail } = useExcerptDetail(excerptId);
  const tree = useCodeTree();
  const removeCode = useRemoveExcerptCode();
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  if (!detail) return null;
  return (
    <div className="flex flex-col" data-testid="excerpt-inspector">
      <div className="border-b border-border p-3">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Excerpt
        </h3>
        {detail.kind === "image_region" ? (
          <>
            <RegionThumbnail
              documentId={detail.documentId}
              geometry={detail.geometry}
              width={244}
              height={140}
            />
            <p className="mt-1 text-[11px] text-fg-muted">
              {detail.documentName} · {detail.snapshot}
            </p>
          </>
        ) : (
          <>
            <p className="font-serif text-sm leading-snug">
              <span className="text-fg-muted">…{detail.contextBefore.slice(-60)}</span>
              <mark className="rounded bg-accent/20 px-0.5 text-fg">{detail.snapshot}</mark>
              <span className="text-fg-muted">{detail.contextAfter.slice(0, 60)}…</span>
            </p>
            <p className="mt-1 text-[11px] text-fg-muted">
              {detail.documentName} · {detail.startPos}–{detail.endPos}
            </p>
          </>
        )}
      </div>
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Codes</h3>
          <Button size="sm" variant="ghost" onClick={() => setPaletteOpen(true)}>
            Add
          </Button>
        </div>
        <ul className="mt-1">
          {detail.codeIds.map((id) => (
            <li
              key={id}
              className="group flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
            >
              <ColorDot color={tree.byId.get(id)?.code.color ?? "#999"} />
              <span className="min-w-0 flex-1 truncate">{pathOf(tree, id)}</span>
              <UseAsExampleButton codeId={id} excerptId={detail.id} />
              <button
                className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100"
                aria-label="Remove code"
                onClick={() =>
                  removeCode
                    .mutateAsync({ id: detail.id, documentId: detail.documentId, codeId: id })
                    .catch(toast.error)
                }
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
          {detail.codeIds.length === 0 ? (
            <li className="px-1 text-sm text-fg-muted">Uncoded.</li>
          ) : null}
        </ul>
      </div>
      <MemoList target={{ excerptId }} heading="Memos" />
    </div>
  );
}
