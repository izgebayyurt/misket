import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "@/queries/documents";
import { useCodes } from "@/queries/codes";
import { useApplyCodes, useDeleteExcerpt, useDocumentExcerpts } from "@/queries/excerpts";
import { buildOffsetMap, cpToUtf16, utf16ToCp } from "@/core/offsets";
import {
  MAX_LANES,
  segmentParagraph,
  splitParagraphs,
  type RenderableExcerpt,
  type Segment,
} from "@/core/segmentation";
import { offsetsToRange, rangeToOffsets } from "@/core/selection";
import { isTextField, mod } from "@/core/keymap";
import { useWorkspace } from "@/state/workspace";
import { useShortcutActions } from "@/state/shortcutActions";
import { useSettings } from "@/state/settings";
import { SelectionToolbar } from "./SelectionToolbar";
import { ExcerptPopover } from "./ExcerptPopover";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  documentId: string;
  focusExcerptId?: string;
}

export function DocumentView({ documentId, focusExcerptId }: Props) {
  const { data: doc, error } = useDocument(documentId);
  const { data: excerpts } = useDocumentExcerpts(documentId);
  const { data: codes } = useCodes();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pending = useWorkspace((s) => s.pendingSelection);
  const setPending = useWorkspace((s) => s.setPendingSelection);
  const focusedId = useWorkspace((s) => s.focusedExcerptId);
  const setFocusedId = useWorkspace((s) => s.setFocusedExcerptId);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const applyCodes = useApplyCodes();
  const deleteExcerpt = useDeleteExcerpt();
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [popover, setPopover] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const text = doc?.text ?? "";
  const offsetMap = useMemo(() => buildOffsetMap(text), [text]);
  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  const colorById = useMemo(() => new Map((codes ?? []).map((c) => [c.id, c.color])), [codes]);
  const shortcutToCode = useMemo(
    () => new Map((codes ?? []).filter((c) => c.shortcut).map((c) => [c.shortcut!, c.id])),
    [codes],
  );

  /** Excerpts in DOM (UTF-16) space, sorted by start. */
  const renderable = useMemo<RenderableExcerpt[]>(() => {
    if (!excerpts || !text) return [];
    return excerpts
      .filter((e) => e.kind === "text" && e.startPos !== null && e.endPos !== null)
      .map((e) => ({
        id: e.id,
        start: cpToUtf16(offsetMap, e.startPos!),
        end: cpToUtf16(offsetMap, e.endPos!),
        codeIds: e.codeIds,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }, [excerpts, offsetMap, text]);

  const excerptById = useMemo(() => new Map((excerpts ?? []).map((e) => [e.id, e])), [excerpts]);

  // --- selection -> pendingSelection ---------------------------------------
  const readSelection = useCallback(() => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setToolbarPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const offs = rangeToOffsets(range, root, text);
    if (!offs) {
      setToolbarPos(null);
      return;
    }
    setPending({
      documentId,
      start: utf16ToCp(offsetMap, offs.start),
      end: utf16ToCp(offsetMap, offs.end),
    });
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const container = scrollRef.current;
    const box = container?.getBoundingClientRect();
    setToolbarPos({
      top: rect.bottom - (box?.top ?? 0) + (container?.scrollTop ?? 0) + 6,
      left: Math.max(8, rect.right - (box?.left ?? 0) - 60),
    });
  }, [documentId, offsetMap, setPending, text]);

  useEffect(() => {
    const onMouseUp = () => setTimeout(readSelection, 0);
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed) setToolbarPos(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [readSelection]);

  // --- focus / scroll-to ---------------------------------------------------
  const scrollToExcerpt = useCallback((id: string, flash: boolean) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-x~="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (flash) {
      setFlashId(id);
      setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1300);
    }
  }, []);

  useEffect(() => {
    if (focusExcerptId && excerpts) {
      setFocusedId(focusExcerptId);
      requestAnimationFrame(() => scrollToExcerpt(focusExcerptId, true));
    }
    // only when the target excerpt changes or excerpts first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusExcerptId, !!excerpts]);

  const openPopover = useCallback((id: string) => {
    const anchor = rootRef.current?.querySelector<HTMLElement>(`[data-x~="${CSS.escape(id)}"]`);
    setPopover(anchor ? { id, anchor } : null);
  }, []);

  /** Grow the current selection (or the focused excerpt) by one word. */
  const extendSelection = useCallback(
    (dir: "left" | "right") => {
      const root = rootRef.current;
      const sel = window.getSelection();
      if (!root || !sel) return;
      if (sel.isCollapsed || !root.contains(sel.anchorNode)) {
        // Start from the focused excerpt's range, if any.
        const id = useWorkspace.getState().focusedExcerptId;
        const ex = id ? renderable.find((e) => e.id === id) : undefined;
        if (!ex) return;
        const range = offsetsToRange(root, ex.start, ex.end);
        if (!range) return;
        sel.removeAllRanges();
        if (dir === "left") {
          // Focus end at the start so "extend backward" grows leftwards.
          sel.setBaseAndExtent(
            range.endContainer,
            range.endOffset,
            range.startContainer,
            range.startOffset,
          );
        } else {
          sel.addRange(range);
        }
      }
      sel.modify("extend", dir === "left" ? "backward" : "forward", "word");
      readSelection();
    },
    [renderable, readSelection],
  );

  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      if (renderable.length === 0) return;
      const idx = focusedId ? renderable.findIndex((e) => e.id === focusedId) : -1;
      let next: number;
      if (idx === -1) next = delta === 1 ? 0 : renderable.length - 1;
      else next = (idx + delta + renderable.length) % renderable.length;
      const target = renderable[next]!;
      window.getSelection()?.removeAllRanges();
      setFocusedId(target.id);
      setPopover(null);
      scrollToExcerpt(target.id, false);
    },
    [focusedId, renderable, scrollToExcerpt, setFocusedId],
  );

  // --- shortcut handlers registered with the global listener --------------
  useEffect(() => {
    const unregister = useShortcutActions.getState().register({
      nextExcerpt: () => moveFocus(1),
      prevExcerpt: () => moveFocus(-1),
      editExcerpt: () => {
        if (focusedId) openPopover(focusedId);
      },
      deleteExcerpt: () => {
        if (!focusedId) return;
        if (useSettings.getState().settings.confirmDeleteExcerpt) {
          setConfirmDeleteId(focusedId);
        } else {
          deleteExcerpt.mutate({ id: focusedId, documentId });
        }
      },
      extendSelectionLeft: () => extendSelection("left"),
      extendSelectionRight: () => extendSelection("right"),
      // Escape peels one layer at a time: selection, then focus. (An open
      // popover is closed by Radix before this runs.)
      escape: () => {
        const ws = useWorkspace.getState();
        if (ws.pendingSelection) {
          ws.setPendingSelection(null);
          window.getSelection()?.removeAllRanges();
          return;
        }
        ws.setFocusedExcerptId(null);
      },
    });
    return unregister;
  }, [moveFocus, focusedId, deleteExcerpt, documentId, openPopover, extendSelection]);

  const applyToSelection = useCallback(
    async (codeIds: string[]) => {
      const p = useWorkspace.getState().pendingSelection;
      if (!p) return;
      try {
        const r = await applyCodes.mutateAsync({
          documentId,
          startPos: p.start,
          endPos: p.end,
          codeIds,
        });
        window.getSelection()?.removeAllRanges();
        setPending(null);
        setFocusedId(r.excerpt.id);
      } catch (err) {
        toast.error(err);
      }
    },
    [applyCodes, documentId, setPending, setFocusedId],
  );

  // --- code hotkeys: a single key applies a code to the selection/focus ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTextField(e.target) || mod(e) || e.altKey || e.key.length !== 1) return;
      if (useWorkspace.getState().paletteOpen) return;
      const codeId = shortcutToCode.get(e.key.toLowerCase());
      if (!codeId) return;
      const ws = useWorkspace.getState();
      if (ws.pendingSelection && ws.pendingSelection.documentId === documentId) {
        e.preventDefault();
        void applyToSelection([codeId]);
      } else if (ws.focusedExcerptId) {
        e.preventDefault();
        const ex = excerptById.get(ws.focusedExcerptId);
        if (ex && ex.startPos !== null && ex.endPos !== null) {
          applyCodes.mutate({
            documentId,
            startPos: ex.startPos,
            endPos: ex.endPos,
            codeIds: [codeId],
          });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutToCode, documentId, excerptById, applyToSelection, applyCodes]);

  function onSegmentClick(e: React.MouseEvent, seg: Segment) {
    if (seg.excerptIds.length === 0) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // a drag-selection, not a click
    e.preventDefault();
    // Cycle through overlapping excerpts on repeated clicks.
    const idx = focusedId ? seg.excerptIds.indexOf(focusedId) : -1;
    const next = seg.excerptIds[(idx + 1) % seg.excerptIds.length]!;
    setFocusedId(next);
    setPopover({ id: next, anchor: e.currentTarget as HTMLElement });
  }

  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto" data-testid="document-view">
      <div className="mx-auto max-w-3xl px-10 py-10">
        <h1 className="mb-6 font-serif text-2xl font-medium">{doc.name}</h1>
        <div ref={rootRef} className="doc-text" data-testid="doc-text">
          {paragraphs.map((p) => (
            <Paragraph
              key={p.start}
              start={p.start}
              end={p.end}
              text={p.text}
              excerpts={renderable}
              colorById={colorById}
              focusedId={focusedId}
              flashId={flashId}
              onSegmentClick={onSegmentClick}
            />
          ))}
        </div>
      </div>
      {toolbarPos && pending ? (
        <SelectionToolbar pos={toolbarPos} onCode={() => setPaletteOpen(true)} />
      ) : null}
      {popover && excerptById.get(popover.id) ? (
        <ExcerptPopover
          excerpt={excerptById.get(popover.id)!}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onDelete={() => {
            const id = popover.id;
            setPopover(null);
            if (useSettings.getState().settings.confirmDeleteExcerpt) {
              setConfirmDeleteId(id);
            } else {
              deleteExcerpt.mutate({ id, documentId });
            }
          }}
        />
      ) : null}
      {confirmDeleteId ? (
        <ConfirmDialog
          title="Delete this excerpt?"
          description="Its codes and memos go with it. You can undo with Ctrl/⌘+Z."
          onConfirm={() => {
            deleteExcerpt.mutate({ id: confirmDeleteId, documentId });
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      ) : null}
    </div>
  );
}

interface ParagraphProps {
  start: number;
  end: number;
  text: string;
  excerpts: RenderableExcerpt[];
  colorById: Map<string, string>;
  focusedId: string | null;
  flashId: string | null;
  onSegmentClick: (e: React.MouseEvent, seg: Segment) => void;
}

const Paragraph = memo(function Paragraph(p: ParagraphProps) {
  const segments = useMemo(
    () => segmentParagraph(p.start, p.end, p.excerpts),
    [p.start, p.end, p.excerpts],
  );
  if (p.text.length === 0) {
    return (
      <p data-p={p.start}>
        <br />
      </p>
    );
  }
  return (
    <p data-p={p.start}>
      {segments.map((seg) => {
        const lanes = seg.codeIds.slice(0, MAX_LANES).map((id) => p.colorById.get(id) ?? "#999");
        const style: Record<string, string> = {};
        lanes.forEach((c, i) => (style[`--l${i + 1}`] = c));
        const n = Math.min(seg.excerptIds.length, MAX_LANES);
        const focused = p.focusedId !== null && seg.excerptIds.includes(p.focusedId);
        const flash = p.flashId !== null && seg.excerptIds.includes(p.flashId);
        return (
          <span
            key={seg.start}
            data-s={seg.start}
            data-x={seg.excerptIds.length ? seg.excerptIds.join(" ") : undefined}
            data-n={n}
            className={cn("seg", focused && "focused", flash && "flash")}
            style={style as React.CSSProperties}
            onClick={(e) => p.onSegmentClick(e, seg)}
            title={
              seg.codeIds.length > MAX_LANES
                ? `+${seg.codeIds.length - MAX_LANES} more codes`
                : undefined
            }
          >
            {p.text.slice(seg.start - p.start, seg.end - p.start)}
          </span>
        );
      })}
    </p>
  );
}, areParagraphPropsEqual);

/** Re-render a paragraph only when something intersecting it changed. */
function areParagraphPropsEqual(a: ParagraphProps, b: ParagraphProps): boolean {
  if (a.start !== b.start || a.end !== b.end || a.text !== b.text || a.colorById !== b.colorById)
    return false;
  const intersects = (list: RenderableExcerpt[]) =>
    list.filter((e) => e.start < b.end && e.end > b.start);
  const ia = intersects(a.excerpts);
  const ib = intersects(b.excerpts);
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    const x = ia[i]!;
    const y = ib[i]!;
    if (
      x.id !== y.id ||
      x.start !== y.start ||
      x.end !== y.end ||
      x.codeIds.join() !== y.codeIds.join()
    )
      return false;
  }
  const ids = new Set(ib.map((e) => e.id));
  const touches = (id: string | null) => id !== null && ids.has(id);
  if (
    touches(a.focusedId) !== touches(b.focusedId) &&
    (touches(a.focusedId) || touches(b.focusedId))
  )
    return false;
  if (a.focusedId !== b.focusedId && (touches(a.focusedId) || touches(b.focusedId))) return false;
  if (a.flashId !== b.flashId && (touches(a.flashId) || touches(b.flashId))) return false;
  return true;
}
