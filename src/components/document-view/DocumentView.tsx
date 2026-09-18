import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "@/queries/documents";
import { useCodes, useCodeTree } from "@/queries/codes";
import { inVivoName, siblingNames, uniqueSiblingName } from "@/core/codeTree";
import {
  useApplyCodes,
  useDeleteExcerpt,
  useDocumentExcerpts,
  useInVivoCode,
  useMergeExcerpts,
  useSetExcerptWeight,
  useSplitExcerpt,
  useUpdateExcerptRange,
} from "@/queries/excerpts";
import { snapWeight } from "@/core/weights";
import type { ExcerptWithCodes } from "@/api/types";
import { buildOffsetMap, codePointCount, cpToUtf16, utf16ToCp } from "@/core/offsets";
import {
  MAX_LANES,
  segmentParagraph,
  splitParagraphs,
  type RenderableExcerpt,
  type Segment,
} from "@/core/segmentation";
import { offsetsToRange, pointToOffset, rangeToOffsets } from "@/core/selection";
import { clipToSpokenText, labelCut } from "@/core/turns";
import { nextBoundary, type Direction, type Granularity } from "@/core/wordBounds";
import { isTextField, mod, type Action } from "@/core/keymap";
import { findMatches } from "@/core/find";
import { useProjectInfo } from "@/queries/project";
import { useWorkspace } from "@/state/workspace";
import { useReadingPositions } from "@/state/readingPositions";
import { useShortcutActions } from "@/state/shortcutActions";
import { coderIdsOf } from "@/core/coders";
import { useCoders } from "@/queries/coders";
import { useSettings } from "@/state/settings";
import { useTranscript } from "@/queries/transcripts";
import { paragraphContext } from "@/core/assist/context";
import { SuggestCodes } from "@/components/assist/SuggestCodes";
import { useAssistEnabled } from "@/components/assist/useAssist";
import { CodeDialog } from "@/components/codebook/CodeDialog";
import type { AssistedRef } from "@/api/types";
import { SelectionToolbar } from "./SelectionToolbar";
import { ExcerptPopover } from "./ExcerptPopover";
import { DocumentTitle } from "./DocumentTitle";
import { SpeakersMenu } from "./SpeakersMenu";
import { TranscriptChip } from "./TranscriptChip";
import { FindBar } from "./FindBar";
import { GoToParagraphBar } from "./GoToParagraphBar";
import { TOAST_KEYS, toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  documentId: string;
  focusExcerptId?: string;
  /** Code point offset to scroll to once the text has rendered (e.g. from a project search hit). */
  scrollToOffset?: number;
}

export function DocumentView({ documentId, focusExcerptId, scrollToOffset }: Props) {
  const { data: doc, error } = useDocument(documentId);
  const { data: excerpts } = useDocumentExcerpts(documentId);
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const { data: projectInfo } = useProjectInfo();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pending = useWorkspace((s) => s.pendingSelection);
  const setPending = useWorkspace((s) => s.setPendingSelection);
  const focusedId = useWorkspace((s) => s.focusedExcerptId);
  const setFocusedId = useWorkspace((s) => s.setFocusedExcerptId);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const applyCodes = useApplyCodes();
  const inVivoCode = useInVivoCode();
  const deleteExcerpt = useDeleteExcerpt();
  const updateRange = useUpdateExcerptRange();
  const splitExcerpt = useSplitExcerpt();
  const mergeExcerpts = useMergeExcerpts();
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [popover, setPopover] = useState<{
    id: string;
    anchor: HTMLElement;
    /** Where the click landed, in code points: the "Split here" point. */
    caret: number | null;
  } | null>(null);
  /** A boundary drag in progress, in code points; rendered instead of the stored range. */
  const [drag, setDrag] = useState<DragState | null>(null);
  const [handles, setHandles] = useState<HandleBoxes | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findStem, setFindStem] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /**
   * An open "Suggest codes" panel: which passage it is about and where it
   * sits. It keeps its own copy of the range so that losing the browser
   * selection — which clicking a chip does — cannot apply a code to the
   * wrong place.
   */
  const [suggesting, setSuggesting] = useState<{
    start: number;
    end: number;
    passage: string;
    before: string;
    after: string;
    top: number;
    left: number;
  } | null>(null);
  /** A "new code" suggestion the person clicked: the dialog, prefilled. */
  const [newCodeFrom, setNewCodeFrom] = useState<{
    name: string;
    assisted: AssistedRef;
    start: number;
    end: number;
  } | null>(null);
  const suggestEnabled = useAssistEnabled("suggestCodes");
  const [goToOpen, setGoToOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const showParagraphNumbers = useSettings((s) => s.settings.showParagraphNumbers);
  const showSpeakerGutter = useSettings((s) => s.settings.showSpeakerGutter);
  const lanesByCoder = useSettings((s) => s.settings.lanesByCoder);
  const { data: coders } = useCoders();
  const { data: transcript } = useTranscript(documentId);

  const text = doc?.text ?? "";
  const offsetMap = useMemo(() => buildOffsetMap(text), [text]);
  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  /**
   * UTF-16 starts of the paragraphs that carry a number in the gutter, in
   * order: blank lines are skipped, exactly as the CSS counter skips them, so
   * `numberedStarts[n - 1]` is the paragraph the reader sees as "n".
   */
  const numberedStarts = useMemo(
    () => paragraphs.filter((p) => p.text.length > 0).map((p) => p.start),
    [paragraphs],
  );
  /**
   * The turns, in DOM (UTF-16) space. The labels stay in the text — it is
   * immutable, and every excerpt offset is an index into it — so the view
   * only lays them out elsewhere: each label range becomes its own segment(s)
   * (`cuts`) that CSS lifts into a gutter beside the paragraph.
   */
  const turnsU16 = useMemo(() => {
    if (!transcript || !text) return [];
    return transcript.turns.map((t) => ({
      speaker: t.speaker,
      time: t.time,
      labelStart: cpToUtf16(offsetMap, t.labelStart),
      labelEnd: cpToUtf16(offsetMap, t.labelEnd),
      start: cpToUtf16(offsetMap, t.start),
      end: cpToUtf16(offsetMap, t.end),
    }));
  }, [offsetMap, text, transcript]);

  /**
   * Turn layout by paragraph start: a label always begins its own line, so
   * the paragraph that opens a turn is the one whose `data-p` is its
   * `labelStart`. `cuts` are the extra segment boundaries inside it.
   */
  const turnByParagraph = useMemo(() => {
    const out = new Map<number, { speaker: string; time: string | null; cuts: number[] }>();
    if (!showSpeakerGutter) return out;
    for (const t of turnsU16) {
      const cut = labelCut(text, t);
      out.set(t.labelStart, {
        speaker: t.speaker,
        time: t.time,
        cuts: cut === null ? [t.labelEnd] : [cut, t.labelEnd],
      });
    }
    return out;
  }, [showSpeakerGutter, text, turnsU16]);

  // What an underline lane stands for. Normally a code, and the colour is the
  // code's; with "colour lanes by coder" on, a coder, and the colour is
  // theirs. Nothing else changes: segmentation, the `.doc-text` contract and
  // the per-segment `--l1`…`--l4` variables are the same either way, which is
  // why the swap happens here rather than in the renderer.
  const laneColorById = useMemo(
    () =>
      lanesByCoder
        ? new Map((coders ?? []).map((c) => [c.id, c.color]))
        : new Map((codes ?? []).map((c) => [c.id, c.color])),
    [codes, coders, lanesByCoder],
  );
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
        codeIds: lanesByCoder ? coderIdsOf(e) : e.codeIds,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }, [excerpts, lanesByCoder, offsetMap, text]);

  const excerptById = useMemo(() => new Map((excerpts ?? []).map((e) => [e.id, e])), [excerpts]);

  /** `renderable`, with a boundary drag in progress shown at its tentative range. */
  const previewed = useMemo<RenderableExcerpt[]>(() => {
    if (!drag) return renderable;
    return renderable
      .map((e) =>
        e.id === drag.id
          ? { ...e, start: cpToUtf16(offsetMap, drag.start), end: cpToUtf16(offsetMap, drag.end) }
          : e,
      )
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }, [drag, offsetMap, renderable]);

  const total = useMemo(() => codePointCount(offsetMap), [offsetMap]);

  /**
   * Map a viewport point to a code point offset in the document, using the
   * browser's caret hit-testing and the same `span[data-s]` contract that
   * `src/core/selection.ts` relies on.
   */
  const offsetFromPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const root = rootRef.current;
      if (!root) return null;
      let node: Node | null = null;
      let offset = 0;
      const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
      };
      if (typeof doc.caretPositionFromPoint === "function") {
        const pos = doc.caretPositionFromPoint(clientX, clientY);
        if (pos) {
          node = pos.offsetNode;
          offset = pos.offset;
        }
      } else if (typeof document.caretRangeFromPoint === "function") {
        const r = document.caretRangeFromPoint(clientX, clientY);
        if (r) {
          node = r.startContainer;
          offset = r.startOffset;
        }
      }
      if (!node) return null;
      const u16 = pointToOffset(node, offset, root);
      if (u16 === null) return null;
      return utf16ToCp(offsetMap, Math.max(0, Math.min(u16, text.length)));
    },
    [offsetMap, text.length],
  );

  /** The collapse point of the current selection, in code points. */
  const caretOffset = useCallback((): number | null => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const u16 = pointToOffset(range.startContainer, range.startOffset, root);
    if (u16 === null) return null;
    return utf16ToCp(offsetMap, Math.max(0, Math.min(u16, text.length)));
  }, [offsetMap, text.length]);

  // --- find in document -----------------------------------------------------
  const findResults = useMemo(
    () => (findOpen ? findMatches(text, findQuery, { stem: findStem }) : []),
    [findOpen, findQuery, findStem, text],
  );

  // Jump back to the first match whenever the bar (re)opens, the query
  // changes, or "match word forms" is toggled. Adjusted during render
  // (React's recommended pattern for resetting state in response to a
  // prop/derived-value change) rather than in an effect, which would cause
  // an extra commit after the fact.
  const findResetKey = `${findOpen ? "1" : "0"}:${findStem ? "1" : "0"}:${findQuery}`;
  const [prevFindResetKey, setPrevFindResetKey] = useState(findResetKey);
  if (prevFindResetKey !== findResetKey) {
    setPrevFindResetKey(findResetKey);
    if (findIndex !== 0) setFindIndex(0);
  }

  const findNext = useCallback(() => {
    setFindIndex((i) => (findResults.length ? (i + 1) % findResults.length : 0));
  }, [findResults.length]);
  const findPrev = useCallback(() => {
    setFindIndex((i) =>
      findResults.length ? (i - 1 + findResults.length) % findResults.length : 0,
    );
  }, [findResults.length]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    rootRef.current?.focus();
  }, []);

  // Scroll the current match into view.
  useEffect(() => {
    const root = rootRef.current;
    const m = findResults[findIndex];
    if (!root || !m) return;
    const range = offsetsToRange(root, m.start, m.end);
    const el = range?.startContainer.parentElement;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [findResults, findIndex]);

  // Render match highlights without touching the DOM (CSS Custom Highlight API).
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const root = rootRef.current;
    if (!root || findResults.length === 0) {
      CSS.highlights.delete("find");
      CSS.highlights.delete("find-current");
      return;
    }
    const others: Range[] = [];
    let current: Range | null = null;
    findResults.forEach((m, i) => {
      const r = offsetsToRange(root, m.start, m.end);
      if (!r) return;
      if (i === findIndex) current = r;
      else others.push(r);
    });
    CSS.highlights.set("find", new Highlight(...others));
    if (current) CSS.highlights.set("find-current", new Highlight(current));
    else CSS.highlights.delete("find-current");
    return () => {
      CSS.highlights.delete("find");
      CSS.highlights.delete("find-current");
    };
  }, [findResults, findIndex]);

  // Scroll to a code point offset from outside the view (e.g. a project search hit).
  useEffect(() => {
    if (scrollToOffset === undefined || !text) return;
    const root = rootRef.current;
    if (!root) return;
    const u16 = cpToUtf16(offsetMap, scrollToOffset);
    const point = offsetsToRange(root, u16, u16)?.startContainer.parentElement;
    if (!point) return;
    point.scrollIntoView({ block: "center", behavior: "smooth" });
    point.classList.add("flash");
    const t = setTimeout(() => point.classList.remove("flash"), 1300);
    return () => clearTimeout(t);
    // Re-run only when the target offset (or the document) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToOffset, text]);

  // --- jumping around the document -----------------------------------------
  const jumpTo = useCallback((where: "top" | "bottom") => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({
      top: where === "top" ? 0 : container.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  /** Scroll to the paragraph the gutter numbers `n` and flash it. */
  const jumpToParagraph = useCallback(
    (n: number) => {
      const root = rootRef.current;
      if (!root || numberedStarts.length === 0) return;
      const i = Math.min(Math.max(Math.trunc(n), 1), numberedStarts.length) - 1;
      const el = root.querySelector<HTMLElement>(`p[data-p="${numberedStarts[i]}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const span = el.querySelector<HTMLElement>("span[data-s]");
      if (!span) return;
      span.classList.add("flash");
      setTimeout(() => span.classList.remove("flash"), 1300);
    },
    [numberedStarts],
  );

  const closeGoTo = useCallback(() => {
    setGoToOpen(false);
    // `preventScroll`: focusing the text root would otherwise scroll it back
    // to its own top and undo the jump we just started.
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // --- reading position ------------------------------------------------------
  // Remembered as the code point offset of the first visible paragraph rather
  // than a pixel scroll position, so it survives a change of text size, line
  // height or window width.
  const projectPath = projectInfo?.path ?? "";

  /** The first paragraph still visible in the scroller, in code points. */
  const firstVisibleOffset = useCallback((): number | null => {
    const root = rootRef.current;
    const container = scrollRef.current;
    if (!root || !container) return null;
    const ps = root.querySelectorAll<HTMLElement>("p[data-p]");
    if (ps.length === 0) return null;
    // `offsetTop` is monotonic down the document, so the last paragraph that
    // starts at or above the viewport top is the one the reader is looking at.
    const y = container.scrollTop;
    let lo = 0;
    let hi = ps.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ps[mid]!.offsetTop <= y + 1) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const u16 = Number(ps[best]!.dataset.p);
    if (!Number.isFinite(u16)) return null;
    return utf16ToCp(offsetMap, Math.max(0, Math.min(u16, text.length)));
  }, [offsetMap, text.length]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !text || !projectPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      // Debounced: scrolling past a passage on the way somewhere else should
      // not be what gets remembered.
      timer = setTimeout(() => {
        const cp = firstVisibleOffset();
        if (cp !== null) {
          useReadingPositions.getState().remember(projectPath, documentId, cp);
        }
      }, 250);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      container.removeEventListener("scroll", onScroll);
    };
  }, [documentId, firstVisibleOffset, projectPath, text]);

  /** Which document the position has already been restored for. */
  const restoredFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (restoredFor.current === documentId) return;
    if (!text || !projectPath) return;
    const root = rootRef.current;
    const container = scrollRef.current;
    if (!root || !container) return;
    restoredFor.current = documentId;
    // An explicit target (an excerpt or a search hit) wins over the
    // remembered position; those effects do their own scrolling.
    if (focusExcerptId !== undefined || scrollToOffset !== undefined) return;
    const cp = useReadingPositions.getState().recall(projectPath, documentId);
    if (cp === null || cp <= 0) return;
    const u16 = cpToUtf16(offsetMap, Math.min(cp, codePointCount(offsetMap)));
    const el = root.querySelector<HTMLElement>(`p[data-p="${u16}"]`);
    if (!el) return;
    container.scrollTop +=
      el.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
  }, [documentId, focusExcerptId, offsetMap, projectPath, scrollToOffset, text]);

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
    // A label is laid out in the gutter but still lives in the text, so a
    // drag that started on one (or a select-all) would otherwise code it.
    const clipped = clipToSpokenText(
      { start: utf16ToCp(offsetMap, offs.start), end: utf16ToCp(offsetMap, offs.end) },
      transcript?.turns ?? [],
    );
    if (!clipped) {
      setPending(null);
      setToolbarPos(null);
      return;
    }
    setPending({ documentId, kind: "text", ...clipped });
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const container = scrollRef.current;
    const box = container?.getBoundingClientRect();
    setToolbarPos({
      top: rect.bottom - (box?.top ?? 0) + (container?.scrollTop ?? 0) + 6,
      left: Math.max(8, rect.right - (box?.left ?? 0) - 60),
    });
  }, [documentId, offsetMap, setPending, text, transcript]);

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

  const openPopover = useCallback(
    (id: string) => {
      const anchor = rootRef.current?.querySelector<HTMLElement>(`[data-x~="${CSS.escape(id)}"]`);
      setPopover(anchor ? { id, anchor, caret: caretOffset() } : null);
    },
    [caretOffset],
  );

  // --- excerpt boundaries --------------------------------------------------

  /** Move a text excerpt to a new range through the undoable mutation. */
  const commitRange = useCallback(
    (excerpt: ExcerptWithCodes, startPos: number, endPos: number, label?: string) => {
      if (excerpt.startPos === null || excerpt.endPos === null) return;
      if (startPos === excerpt.startPos && endPos === excerpt.endPos) return;
      updateRange
        .mutateAsync({
          id: excerpt.id,
          documentId,
          startPos,
          endPos,
          previousStartPos: excerpt.startPos,
          previousEndPos: excerpt.endPos,
          label,
        })
        .catch(toast.error);
    },
    [documentId, updateRange],
  );

  const focusedExcerpt = useCallback((): ExcerptWithCodes | null => {
    const id = useWorkspace.getState().focusedExcerptId;
    const ex = id ? excerptById.get(id) : undefined;
    if (!ex || ex.kind !== "text" || ex.startPos === null || ex.endPos === null) return null;
    return ex;
  }, [excerptById]);

  /** Grow or shrink one edge of the focused excerpt by a word or a character. */
  const nudgeBoundary = useCallback(
    (edge: "start" | "end", dir: Direction, granularity: Granularity) => {
      const ex = focusedExcerpt();
      if (!ex) return;
      let startPos = ex.startPos!;
      let endPos = ex.endPos!;
      if (edge === "start") {
        startPos = Math.max(
          0,
          Math.min(nextBoundary(text, startPos, dir, granularity), endPos - 1),
        );
      } else {
        endPos = Math.min(
          total,
          Math.max(nextBoundary(text, endPos, dir, granularity), startPos + 1),
        );
      }
      commitRange(ex, startPos, endPos, "Adjust excerpt boundary");
    },
    [commitRange, focusedExcerpt, text, total],
  );

  /** The touching or overlapping text excerpts on either side of the focused one. */
  const neighbours = useMemo(() => {
    const ex = focusedId ? excerptById.get(focusedId) : undefined;
    let prev: ExcerptWithCodes | null = null;
    let next: ExcerptWithCodes | null = null;
    if (!ex || ex.kind !== "text" || ex.startPos === null || ex.endPos === null)
      return { prev, next };
    for (const o of excerpts ?? []) {
      if (o.id === ex.id || o.kind !== "text" || o.startPos === null || o.endPos === null) continue;
      // Mergeable means touching or overlapping, which is what the backend accepts.
      if (o.startPos > ex.endPos || o.endPos < ex.startPos) continue;
      // Order by (start, end), the same order the list arrives in.
      const before = (a: ExcerptWithCodes, b: ExcerptWithCodes) =>
        a.startPos! < b.startPos! || (a.startPos === b.startPos && a.endPos! < b.endPos!);
      if (before(ex, o)) {
        if (!next || before(o, next)) next = o;
      } else if (!prev || before(prev, o)) {
        prev = o;
      }
    }
    return { prev, next };
  }, [excerpts, excerptById, focusedId]);

  /** Merge the focused excerpt with a neighbour; the focused one survives. */
  const mergeWith = useCallback(
    (other: ExcerptWithCodes | null) => {
      const ex = focusedExcerpt();
      if (!ex || !other) return;
      setPopover(null);
      mergeExcerpts
        .mutateAsync({ leftId: ex.id, rightId: other.id, documentId })
        .catch(toast.error);
    },
    [documentId, focusedExcerpt, mergeExcerpts],
  );

  /** Split the focused excerpt at `at`, or at the caret when it is inside it. */
  const splitFocused = useCallback(
    (at?: number | null) => {
      const ex = focusedExcerpt();
      if (!ex) return;
      const point = at ?? caretOffset();
      if (point === null || point <= ex.startPos! || point >= ex.endPos!) {
        toast.info("Put the cursor inside the excerpt to split it there.", {
          key: TOAST_KEYS.splitExcerpt,
        });
        return;
      }
      setPopover(null);
      splitExcerpt.mutateAsync({ id: ex.id, documentId, at: point }).catch(toast.error);
    },
    [caretOffset, documentId, focusedExcerpt, splitExcerpt],
  );

  // --- drag handles --------------------------------------------------------

  const startDrag = useCallback(
    (edge: "start" | "end") => (e: React.PointerEvent<HTMLDivElement>) => {
      const ex = focusedExcerpt();
      if (!ex) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      setDrag({ id: ex.id, edge, start: ex.startPos!, end: ex.endPos! });
    },
    [focusedExcerpt],
  );

  const moveDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      const cp = offsetFromPoint(e.clientX, e.clientY);
      if (cp === null) return;
      setDrag((d) => {
        if (!d) return d;
        if (d.edge === "start") {
          const start = Math.max(0, Math.min(cp, d.end - 1));
          return start === d.start ? d : { ...d, start };
        }
        const end = Math.min(total, Math.max(cp, d.start + 1));
        return end === d.end ? d : { ...d, end };
      });
    },
    [drag, offsetFromPoint, total],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      const d = drag;
      setDrag(null);
      const ex = excerptById.get(d.id);
      if (ex) commitRange(ex, d.start, d.end, "Drag excerpt boundary");
    },
    [commitRange, drag, excerptById],
  );

  /** Keep the handles on the first and last client rect of the focused range. */
  const focusedBox = useMemo(() => {
    const e = focusedId ? previewed.find((x) => x.id === focusedId) : undefined;
    return e ? { start: e.start, end: e.end } : null;
  }, [focusedId, previewed]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const container = scrollRef.current;
    if (!root || !container || !focusedBox) {
      setHandles(null);
      return;
    }
    const measure = () => {
      const range = offsetsToRange(root, focusedBox.start, focusedBox.end);
      const rects = range ? Array.from(range.getClientRects()).filter((r) => r.height > 0) : [];
      const first = rects[0];
      const last = rects[rects.length - 1];
      if (!first || !last) {
        setHandles(null);
        return;
      }
      const box = container.getBoundingClientRect();
      const next: HandleBoxes = {
        start: {
          left: first.left - box.left + container.scrollLeft,
          top: first.top - box.top + container.scrollTop,
          height: first.height,
        },
        end: {
          left: last.right - box.left + container.scrollLeft,
          top: last.top - box.top + container.scrollTop,
          height: last.height,
        },
      };
      setHandles((prev) => (sameBoxes(prev, next) ? prev : next));
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    observer?.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [focusedBox, text]);

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
    const handlers: Partial<Record<Action, () => void>> = {
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
      find: () => setFindOpen(true),
      jumpTop: () => jumpTo("top"),
      jumpBottom: () => jumpTo("bottom"),
      goToParagraph: () => setGoToOpen(true),
      // Escape peels one layer at a time: the go-to bar, the find bar, then
      // the selection, then the focus. (An open popover is closed by Radix
      // before this runs, and each bar's own input handles Escape locally
      // while it has focus.)
      escape: () => {
        if (goToOpen) {
          closeGoTo();
          return;
        }
        if (findOpen) {
          closeFind();
          return;
        }
        const ws = useWorkspace.getState();
        if (ws.pendingSelection) {
          ws.setPendingSelection(null);
          window.getSelection()?.removeAllRanges();
          return;
        }
        ws.setFocusedExcerptId(null);
      },
    };
    // Boundary editing is only registered while an excerpt is focused, so the
    // arrow chords stay with the browser the rest of the time.
    if (focusedId) {
      Object.assign(handlers, {
        excerptEndLeft: () => nudgeBoundary("end", -1, "word"),
        excerptEndRight: () => nudgeBoundary("end", 1, "word"),
        excerptEndLeftChar: () => nudgeBoundary("end", -1, "char"),
        excerptEndRightChar: () => nudgeBoundary("end", 1, "char"),
        excerptStartLeft: () => nudgeBoundary("start", -1, "word"),
        excerptStartRight: () => nudgeBoundary("start", 1, "word"),
        excerptStartLeftChar: () => nudgeBoundary("start", -1, "char"),
        excerptStartRightChar: () => nudgeBoundary("start", 1, "char"),
        splitExcerpt: () => splitFocused(),
        ...(neighbours.next || neighbours.prev
          ? { mergeExcerpt: () => mergeWith(neighbours.next ?? neighbours.prev) }
          : {}),
      } satisfies Partial<Record<Action, () => void>>);
    }
    return useShortcutActions.getState().register(handlers);
  }, [
    moveFocus,
    focusedId,
    deleteExcerpt,
    documentId,
    openPopover,
    extendSelection,
    findOpen,
    closeFind,
    goToOpen,
    closeGoTo,
    jumpTo,
    nudgeBoundary,
    splitFocused,
    mergeWith,
    neighbours,
  ]);

  const applyToSelection = useCallback(
    async (codeIds: string[]) => {
      const p = useWorkspace.getState().pendingSelection;
      if (p?.kind !== "text") return;
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

  /**
   * Open the suggestions panel for the current selection, with a paragraph of
   * context either side. The passage and its range are copied out now, so the
   * panel keeps working after the browser selection goes away.
   */
  function openSuggestions() {
    const p = useWorkspace.getState().pendingSelection;
    if (p?.kind !== "text" || !doc?.text || !toolbarPos) return;
    const chars = Array.from(doc.text);
    const passage = chars.slice(p.start, p.end).join("");
    const { before, after } = paragraphContext(doc.text, p.start, p.end);
    setSuggesting({
      start: p.start,
      end: p.end,
      passage,
      before,
      after,
      top: toolbarPos.top,
      left: toolbarPos.left,
    });
  }

  /**
   * Accept one suggestion. This is the ordinary coding path — same command,
   * same coder, same undo step — with one extra note saying the person had
   * help, and from which model.
   */
  const applySuggested = useCallback(
    (codeId: string, assisted: AssistedRef) => {
      const target = suggesting;
      if (!target) return;
      applyCodes.mutate(
        {
          documentId,
          startPos: target.start,
          endPos: target.end,
          codeIds: [codeId],
          assisted,
        },
        {
          onSuccess: (r) => {
            window.getSelection()?.removeAllRanges();
            setPending(null);
            setSuggesting(null);
            setFocusedId(r.excerpt.id);
          },
          onError: (e) => toast.error(e),
        },
      );
    },
    [applyCodes, documentId, setFocusedId, setPending, suggesting],
  );

  /**
   * Apply one code to whatever is currently the target — the pending text
   * selection, else the focused excerpt. Shared by the code hotkeys and by
   * quick-code; returns whether there was anything to code at all.
   */
  const applyCodeToTarget = useCallback(
    (codeId: string): boolean => {
      const ws = useWorkspace.getState();
      if (ws.pendingSelection?.kind === "text" && ws.pendingSelection.documentId === documentId) {
        void applyToSelection([codeId]);
        return true;
      }
      if (ws.focusedExcerptId) {
        const ex = excerptById.get(ws.focusedExcerptId);
        if (ex && ex.startPos !== null && ex.endPos !== null) {
          applyCodes.mutate({
            documentId,
            startPos: ex.startPos,
            endPos: ex.endPos,
            codeIds: [codeId],
          });
          return true;
        }
      }
      return false;
    },
    [applyCodes, applyToSelection, documentId, excerptById],
  );

  // --- code hotkeys: a single key applies a code to the selection/focus ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTextField(e.target) || mod(e) || e.altKey || e.key.length !== 1) return;
      if (useWorkspace.getState().paletteOpen) return;
      const codeId = shortcutToCode.get(e.key.toLowerCase());
      if (!codeId) return;
      if (applyCodeToTarget(codeId)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutToCode, applyCodeToTarget]);

  /**
   * In vivo coding: name a code after the words on the page. The name is the
   * selection with its whitespace collapsed and capped, made unique among its
   * siblings; the parent is whichever code the tree has selected, else the
   * root. Creating and applying it is one undoable command.
   */
  const inVivo = useCallback(async () => {
    const ws = useWorkspace.getState();
    const p = ws.pendingSelection;
    if (p?.kind !== "text" || p.documentId !== documentId) {
      toast.info("Select some text to name a code after it.", { key: TOAST_KEYS.inVivo });
      return;
    }
    const quoted = text.slice(cpToUtf16(offsetMap, p.start), cpToUtf16(offsetMap, p.end));
    const base = inVivoName(quoted);
    if (!base) {
      toast.info("That selection has no words to name a code after.", { key: TOAST_KEYS.inVivo });
      return;
    }
    const parentId =
      ws.selectedCodeId && tree.byId.has(ws.selectedCodeId) ? ws.selectedCodeId : null;
    const name = uniqueSiblingName(base, siblingNames(tree, parentId));
    try {
      const r = await inVivoCode.mutateAsync({
        documentId,
        startPos: p.start,
        endPos: p.end,
        name,
        parentId,
      });
      window.getSelection()?.removeAllRanges();
      setPending(null);
      setFocusedId(r.excerptId);
      toast.info(`Created "${name}" and applied it.`);
    } catch (e) {
      toast.error(e);
    }
  }, [documentId, inVivoCode, offsetMap, setFocusedId, setPending, text, tree]);

  useEffect(() => {
    return useShortcutActions.getState().register({ inVivoCode: () => void inVivo() });
  }, [inVivo]);

  // Quick-code: repeat whatever code was applied last, from anywhere in the
  // document. The status bar names it, so this is never a guess.
  useEffect(() => {
    return useShortcutActions.getState().register({
      quickCode: () => {
        const codeId = useWorkspace.getState().lastAppliedCodeId;
        if (!codeId) {
          toast.info("No code has been applied yet — pick one from the palette first.", {
            key: TOAST_KEYS.quickCode,
          });
          return;
        }
        if (!applyCodeToTarget(codeId))
          toast.info("Select some text or focus an excerpt to code first.", {
            key: TOAST_KEYS.codeTarget,
          });
      },
    });
  }, [applyCodeToTarget]);

  // With an excerpt focused, digit keys rate the last applied code on its
  // weight scale (snapped to the nearest step). A no-op — with a hint —
  // whenever there is no excerpt focused, no last code, no scale, or the
  // focused excerpt does not carry that code at all.
  const setWeight = useSetExcerptWeight();
  useEffect(() => {
    const rate = (value: number) => {
      if (!focusedId) {
        toast.info("Focus an excerpt to rate it.");
        return;
      }
      const codeId = useWorkspace.getState().lastAppliedCodeId;
      const code = codeId ? (codes ?? []).find((c) => c.id === codeId) : undefined;
      if (!code) {
        toast.info("No code has been applied yet — pick one from the palette first.");
        return;
      }
      if (!code.weightScale) {
        toast.info(`"${code.name}" has no weight scale.`);
        return;
      }
      const excerpt = excerptById.get(focusedId);
      if (!excerpt?.codeIds.includes(code.id)) {
        toast.info(`Apply "${code.name}" to this excerpt before rating it.`);
        return;
      }
      setWeight.mutate({
        id: focusedId,
        documentId,
        codeId: code.id,
        weight: snapWeight(code.weightScale, value),
      });
    };
    return useShortcutActions.getState().register({
      setWeight1: () => rate(1),
      setWeight2: () => rate(2),
      setWeight3: () => rate(3),
      setWeight4: () => rate(4),
      setWeight5: () => rate(5),
      setWeight6: () => rate(6),
      setWeight7: () => rate(7),
      setWeight8: () => rate(8),
      setWeight9: () => rate(9),
    });
  }, [codes, documentId, excerptById, focusedId, setWeight]);

  function onSegmentClick(e: React.MouseEvent, seg: Segment) {
    if (seg.excerptIds.length === 0) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // a drag-selection, not a click
    // Where the click landed, so the popover can offer "Split here".
    const caret = offsetFromPoint(e.clientX, e.clientY);
    e.preventDefault();
    // Cycle through overlapping excerpts on repeated clicks.
    const idx = focusedId ? seg.excerptIds.indexOf(focusedId) : -1;
    const next = seg.excerptIds[(idx + 1) % seg.excerptIds.length]!;
    setFocusedId(next);
    setPopover({ id: next, anchor: e.currentTarget as HTMLElement, caret });
  }

  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="document-view"
      // F2 renames the open document while focus is inside the viewer (the
      // text root is focusable), the keyboard twin of double-clicking the title.
      onKeyDown={(e) => {
        if (e.key !== "F2" || isTextField(e.target)) return;
        e.preventDefault();
        setRenaming(true);
      }}
    >
      {findOpen ? (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          currentIndex={findIndex}
          total={findResults.length}
          onNext={findNext}
          onPrev={findPrev}
          onClose={closeFind}
          matchWordForms={findStem}
          onMatchWordFormsChange={setFindStem}
        />
      ) : null}
      {goToOpen ? (
        <GoToParagraphBar
          total={numberedStarts.length}
          onGo={jumpToParagraph}
          onClose={closeGoTo}
        />
      ) : null}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn("mx-auto max-w-3xl py-10 pr-10", showParagraphNumbers ? "pl-20" : "pl-10")}
        >
          <div className="mb-6 flex items-start justify-between gap-3">
            <DocumentTitle
              documentId={documentId}
              name={doc.name}
              editing={renaming}
              onEditingChange={setRenaming}
              className="min-w-0 flex-1 font-serif text-2xl font-medium"
            />
            <span className="flex shrink-0 items-center gap-2">
              <TranscriptChip documentId={documentId} />
              <SpeakersMenu documentId={documentId} />
            </span>
          </div>
          <div
            ref={rootRef}
            tabIndex={-1}
            className={cn("doc-text", showParagraphNumbers && "with-para-numbers")}
            data-testid="doc-text"
          >
            {paragraphs.map((p) => (
              <Paragraph
                key={p.start}
                start={p.start}
                end={p.end}
                text={p.text}
                turn={turnByParagraph.get(p.start)}
                excerpts={previewed}
                colorById={laneColorById}
                laneNoun={lanesByCoder ? "coders" : "codes"}
                focusedId={focusedId}
                flashId={flashId}
                onSegmentClick={onSegmentClick}
              />
            ))}
          </div>
        </div>
        {handles && focusedId ? (
          <>
            <BoundaryHandle
              edge="start"
              box={handles.start}
              active={drag?.edge === "start"}
              onPointerDown={startDrag("start")}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
            <BoundaryHandle
              edge="end"
              box={handles.end}
              active={drag?.edge === "end"}
              onPointerDown={startDrag("end")}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </>
        ) : null}
        {toolbarPos && pending ? (
          <SelectionToolbar
            pos={toolbarPos}
            onCode={() => setPaletteOpen(true)}
            onSuggest={suggestEnabled ? openSuggestions : undefined}
          />
        ) : null}
        {newCodeFrom ? (
          <CodeDialog
            mode="create"
            parentId={null}
            initialName={newCodeFrom.name}
            assisted={newCodeFrom.assisted}
            onClose={() => setNewCodeFrom(null)}
            onCreated={(code) => {
              // Creating it and applying it are two steps the person took,
              // and both say they had help.
              applyCodes.mutate(
                {
                  documentId,
                  startPos: newCodeFrom.start,
                  endPos: newCodeFrom.end,
                  codeIds: [code.id],
                  assisted: newCodeFrom.assisted,
                },
                {
                  onSuccess: (r) => {
                    window.getSelection()?.removeAllRanges();
                    setPending(null);
                    setSuggesting(null);
                    setFocusedId(r.excerpt.id);
                  },
                  onError: (e) => toast.error(e),
                },
              );
              setNewCodeFrom(null);
            }}
          />
        ) : null}
        {suggesting ? (
          <div
            className="absolute z-20 w-80 max-w-[90%]"
            style={{ top: suggesting.top + 30, left: suggesting.left }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <SuggestCodes
              key={`${suggesting.start}-${suggesting.end}`}
              passage={suggesting.passage}
              contextBefore={suggesting.before}
              contextAfter={suggesting.after}
              onApply={applySuggested}
              onNewCode={(name, assisted) =>
                setNewCodeFrom({
                  name,
                  assisted,
                  start: suggesting.start,
                  end: suggesting.end,
                })
              }
              onClose={() => setSuggesting(null)}
            />
          </div>
        ) : null}
        {popover && excerptById.get(popover.id) ? (
          <ExcerptPopover
            excerpt={excerptById.get(popover.id)!}
            anchor={popover.anchor}
            onClose={() => setPopover(null)}
            canSplitHere={
              popover.caret !== null &&
              popover.caret > (excerptById.get(popover.id)?.startPos ?? 0) &&
              popover.caret < (excerptById.get(popover.id)?.endPos ?? 0)
            }
            onSplit={() => splitFocused(popover.caret)}
            onMergePrevious={neighbours.prev ? () => mergeWith(neighbours.prev) : undefined}
            onMergeNext={neighbours.next ? () => mergeWith(neighbours.next) : undefined}
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
    </div>
  );
}

/** A boundary drag in progress: code point offsets, live. */
interface DragState {
  id: string;
  edge: "start" | "end";
  start: number;
  end: number;
}

interface HandleBox {
  left: number;
  top: number;
  height: number;
}

interface HandleBoxes {
  start: HandleBox;
  end: HandleBox;
}

function sameBoxes(a: HandleBoxes | null, b: HandleBoxes): boolean {
  if (!a) return false;
  return (["start", "end"] as const).every(
    (k) => a[k].left === b[k].left && a[k].top === b[k].top && a[k].height === b[k].height,
  );
}

interface BoundaryHandleProps {
  edge: "start" | "end";
  box: HandleBox;
  active?: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * A draggable grip on one edge of the focused excerpt. It lives in the scroll
 * container, never inside `.doc-text`, because only `span[data-s]` elements
 * with a single text node may appear there.
 */
function BoundaryHandle({ edge, box, active, ...handlers }: BoundaryHandleProps) {
  return (
    <div
      {...handlers}
      // A mouse affordance for what the keyboard shortcuts already do, so it
      // stays out of the accessibility tree rather than pretending to be a slider.
      aria-hidden="true"
      data-testid={`excerpt-handle-${edge}`}
      className={cn("excerpt-handle", active && "active")}
      style={{ left: box.left, top: box.top, height: box.height }}
    />
  );
}

interface ParagraphProps {
  start: number;
  end: number;
  text: string;
  excerpts: RenderableExcerpt[];
  colorById: Map<string, string>;
  /** What the lanes stand for, for the "+N more" title: codes, or coders. */
  laneNoun: string;
  focusedId: string | null;
  flashId: string | null;
  /** Set when this paragraph opens a speaker turn and the gutter is on. */
  turn?: { speaker: string; time: string | null; cuts: number[] };
  onSegmentClick: (e: React.MouseEvent, seg: Segment) => void;
}

const Paragraph = memo(function Paragraph(p: ParagraphProps) {
  const cuts = p.turn?.cuts;
  const segments = useMemo(
    () => segmentParagraph(p.start, p.end, p.excerpts, cuts),
    [p.start, p.end, p.excerpts, cuts],
  );
  // Where the speaker label ends: every segment before it is gutter, the rest
  // is what was said. `cuts` always ends at the label's own end.
  const labelEnd = cuts?.[cuts.length - 1] ?? p.start;
  if (p.text.length === 0) {
    // Blank lines carry no paragraph number, so the gutter counts paragraphs
    // rather than lines (see `.doc-text.with-para-numbers` in globals.css).
    return (
      <p data-p={p.start} className="blank">
        <br />
      </p>
    );
  }
  return (
    <p
      data-p={p.start}
      data-turn={p.turn?.speaker}
      data-time={p.turn?.time ?? undefined}
      className={cn(
        p.turn && "turn",
        // Two label segments already put the timestamp on its own line; with
        // one, `data-time` draws it as a pseudo-element, which is not a DOM
        // text node and so leaves the span[data-s] contract intact.
        p.turn?.time && p.turn.cuts.length < 2 && "time-after",
      )}
    >
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
            className={cn(
              "seg",
              // Part of the speaker label: still a span[data-s] with one text
              // node, just positioned in the gutter by CSS.
              seg.end <= labelEnd && p.turn && "label",
              focused && "focused",
              flash && "flash",
            )}
            style={style as React.CSSProperties}
            onClick={(e) => p.onSegmentClick(e, seg)}
            title={
              seg.codeIds.length > MAX_LANES
                ? `+${seg.codeIds.length - MAX_LANES} more ${p.laneNoun}`
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
  if (
    a.start !== b.start ||
    a.end !== b.end ||
    a.text !== b.text ||
    a.colorById !== b.colorById ||
    a.laneNoun !== b.laneNoun
  )
    return false;
  // Turning the gutter on or off, or re-reading the document with another
  // transcript format, changes where the segments break.
  if (a.turn?.speaker !== b.turn?.speaker || a.turn?.time !== b.turn?.time) return false;
  if ((a.turn?.cuts ?? []).join() !== (b.turn?.cuts ?? []).join()) return false;
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
