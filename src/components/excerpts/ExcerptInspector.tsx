import { X } from "lucide-react";
import { useState } from "react";
import { useExcerptDetail, useRemoveExcerptCode, useUpdateExcerptRange } from "@/queries/excerpts";
import { useCodeTree } from "@/queries/codes";
import { useCoders } from "@/queries/coders";
import { CoderMark } from "@/components/coders/CoderMark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { UseAsExampleButton } from "@/components/codebook/UseAsExampleButton";
import { Button } from "@/components/ui/button";
import { MemoList } from "@/components/memos/MemoList";
import { ExcerptHistory } from "@/components/activity/HistoryTimeline";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { formatTimecode, parseTimecode } from "@/core/media";
import { Input } from "@/components/ui/input";
import { MediaThumbnail } from "./MediaThumbnail";
import { RegionThumbnail } from "./RegionThumbnail";

/** Right-panel view of the focused excerpt: context, codes, memos. */
export function ExcerptInspector({ excerptId }: { excerptId: string }) {
  const { data: detail } = useExcerptDetail(excerptId);
  const tree = useCodeTree();
  const removeCode = useRemoveExcerptCode();
  const { data: coders } = useCoders();
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  if (!detail) return null;
  const me = coders?.find((c) => c.isLocal)?.id;
  const nameOf = (coderId: string) =>
    coderId === me ? "my" : `${coders?.find((c) => c.id === coderId)?.name ?? coderId}'s`;
  const remove = (codeId: string, coderId?: string) =>
    removeCode
      .mutateAsync({ id: detail.id, documentId: detail.documentId, codeId, coderId })
      .catch(toast.error);
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
        ) : detail.kind === "video_range" ? (
          <>
            <MediaThumbnail
              documentId={detail.documentId}
              excerptId={detail.id}
              startMs={detail.startPos}
              endMs={detail.endPos}
              width={244}
              height={140}
            />
            <p className="mt-1 text-[11px] text-fg-muted">{detail.documentName}</p>
            <MediaRangeEditor
              excerptId={detail.id}
              documentId={detail.documentId}
              startMs={detail.startPos ?? 0}
              endMs={detail.endPos ?? 0}
            />
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
          {detail.codeIds.map((id) => {
            // Who applied this code. One coding and it is mine is the
            // ordinary case, and gets the ordinary ×; anything else offers a
            // choice, because taking back your own work and taking away a
            // colleague's are different acts.
            const applied = (detail.codings ?? [])
              .filter((c) => c.codeId === id)
              .map((c) => c.coderId);
            const mineOnly = applied.length <= 1 && (applied.length === 0 || applied[0] === me);
            return (
              <li
                key={id}
                className="group flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
              >
                <ColorDot color={tree.byId.get(id)?.code.color ?? "#999"} />
                <span className="min-w-0 flex-1 truncate">{pathOf(tree, id)}</span>
                {coders && coders.length > 1
                  ? applied.map((coderId) => <CoderMark key={coderId} coderId={coderId} />)
                  : null}
                <UseAsExampleButton codeId={id} excerptId={detail.id} />
                {mineOnly ? (
                  <button
                    className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100"
                    aria-label="Remove code"
                    onClick={() => void remove(id)}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label="Remove code"
                    >
                      <X className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {applied.map((coderId) => (
                        <DropdownMenuItem
                          key={coderId}
                          danger
                          onSelect={() => void remove(id, coderId)}
                        >
                          Remove {nameOf(coderId)} coding
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
          {detail.codeIds.length === 0 ? (
            <li className="px-1 text-sm text-fg-muted">Uncoded.</li>
          ) : null}
        </ul>
      </div>
      <MemoList target={{ excerptId }} heading="Memos" />
      <ExcerptHistory excerptId={excerptId} />
    </div>
  );
}

/**
 * The in- and out-points of a coded stretch, editable.
 *
 * Typed as `m:ss.s` (or plain seconds), applied through the same
 * `update_range` the text viewer's boundary keys use — so it is one undoable
 * step, and the `[in-out]` label is rewritten by Rust rather than here.
 */
function MediaRangeEditor({
  excerptId,
  documentId,
  startMs,
  endMs,
}: {
  excerptId: string;
  documentId: string;
  startMs: number;
  endMs: number;
}) {
  const updateRange = useUpdateExcerptRange();
  const [draft, setDraft] = useState<{ in: string; out: string } | null>(null);
  const shown = draft ?? { in: formatTimecode(startMs), out: formatTimecode(endMs) };

  const commit = async (next: { in: string; out: string }) => {
    const start = parseTimecode(next.in);
    const end = parseTimecode(next.out);
    setDraft(null);
    if (start === null || end === null) {
      toast.info("Times read as m:ss.s — for example 1:02.4.");
      return;
    }
    try {
      await updateRange.mutateAsync({
        id: excerptId,
        documentId,
        startPos: start,
        endPos: end,
        previousStartPos: startMs,
        previousEndPos: endMs,
      });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1.5" data-testid="media-range-editor">
      <TimeField
        label="In"
        value={shown.in}
        onChange={(v) => setDraft({ ...shown, in: v })}
        onCommit={() => void commit(shown)}
      />
      <span className="text-fg-muted">–</span>
      <TimeField
        label="Out"
        value={shown.out}
        onChange={(v) => setDraft({ ...shown, out: v })}
        onCommit={() => void commit(shown)}
      />
      <span className="text-[11px] text-fg-muted">
        {formatTimecode(Math.max(0, endMs - startMs))} long
      </span>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-fg-muted">
      {label}
      <Input
        value={value}
        aria-label={`${label}-point`}
        className="h-6 w-20 px-1 py-0 font-mono text-xs tabular-nums"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
