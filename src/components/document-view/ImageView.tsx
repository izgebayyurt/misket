import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { mediaUrl } from "@/api/media";
import { useCodes } from "@/queries/codes";
import { useApplyCodes, useDeleteExcerpt, useDocumentExcerpts } from "@/queries/excerpts";
import { useDocument } from "@/queries/documents";
import { parseGeometry, rectFromPoints, type Rect } from "@/core/imageCrop";
import { isTextField, mod } from "@/core/keymap";
import { useWorkspace } from "@/state/workspace";
import { useShortcutActions } from "@/state/shortcutActions";
import { useSettings } from "@/state/settings";
import { TOAST_KEYS, toast } from "@/state/toasts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DocumentTitle } from "./DocumentTitle";
import { ExcerptPopover } from "./ExcerptPopover";
import { SelectionToolbar } from "./SelectionToolbar";

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;
/** Shorter drags are clicks, not rectangles (screen pixels). */
const MIN_DRAG_PX = 8;
/** Breathing room left around the image when it is fitted. */
const FIT_PADDING = 24;

interface Props {
  documentId: string;
  /** Focus and centre this region once the excerpts have loaded. */
  focusExcerptId?: string;
}

/** Where the image sits in the viewport: `scale` plus a top-left offset. */
interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface Region {
  id: string;
  rect: Rect;
  color: string;
  codeCount: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Image documents: pan and zoom, existing region excerpts drawn over the
 * image, and a drag to draw a new one. Once a rectangle is drawn it becomes
 * the pending selection, so the palette and the code hotkeys apply codes to
 * it exactly as they do to selected text.
 */
export function ImageView({ documentId, focusExcerptId }: Props) {
  const { data: doc, error } = useDocument(documentId);
  const { data: excerpts } = useDocumentExcerpts(documentId);
  const { data: codes } = useCodes();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const applyCodes = useApplyCodes();
  const deleteExcerpt = useDeleteExcerpt();
  const pending = useWorkspace((s) => s.pendingSelection);
  const setPending = useWorkspace((s) => s.setPendingSelection);
  const focusedId = useWorkspace((s) => s.focusedExcerptId);
  const setFocusedId = useWorkspace((s) => s.setFocusedExcerptId);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);

  const [box, setBox] = useState({ width: 0, height: 0 });
  const [stored, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [popover, setPopover] = useState<{ id: string; anchor: Element } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const natural = doc?.media ?? null;
  const colorById = useMemo(() => new Map((codes ?? []).map((c) => [c.id, c.color])), [codes]);

  /** Region excerpts, largest first so small ones stay clickable on top. */
  const regions = useMemo<Region[]>(() => {
    const out: Region[] = [];
    for (const e of excerpts ?? []) {
      if (e.kind !== "image_region") continue;
      const rect = parseGeometry(e.geometry);
      if (!rect) continue;
      out.push({
        id: e.id,
        rect,
        color: colorById.get(e.codeIds[0] ?? "") ?? "#9a9a9a",
        codeCount: e.codeIds.length,
      });
    }
    return out.sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
  }, [excerpts, colorById]);

  const excerptById = useMemo(() => new Map((excerpts ?? []).map((e) => [e.id, e])), [excerpts]);

  // --- viewport -------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback((): View | null => {
    if (!natural || box.width === 0 || box.height === 0) return null;
    const scale = clamp(
      Math.min(
        (box.width - FIT_PADDING * 2) / natural.width,
        (box.height - FIT_PADDING * 2) / natural.height,
      ),
      MIN_SCALE,
      4,
    );
    return {
      scale,
      tx: (box.width - natural.width * scale) / 2,
      ty: (box.height - natural.height * scale) / 2,
    };
  }, [box.height, box.width, natural]);

  const fit = useCallback(() => setView(fitView()), [fitView]);

  // Until the user pans or zooms the image simply stays fitted, which also
  // re-fits it when the window is resized.
  const view = stored ?? fitView();

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      setView((v) => {
        const cur = v ?? fitView();
        if (!cur) return v;
        const scale = clamp(cur.scale * factor, MIN_SCALE, MAX_SCALE);
        const k = scale / cur.scale;
        return { scale, tx: cx - (cx - cur.tx) * k, ty: cy - (cy - cur.ty) * k };
      });
    },
    [fitView],
  );

  const zoomCentre = useCallback(
    (factor: number) => zoomAt(factor, box.width / 2, box.height / 2),
    [box.height, box.width, zoomAt],
  );

  // Wheel must be a non-passive native listener to be able to zoom instead of scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-step * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const displayed = useMemo(
    () =>
      natural && view
        ? { width: natural.width * view.scale, height: natural.height * view.scale }
        : null,
    [natural, view],
  );

  /** Container point -> image fractions (0..1). */
  const toImage = useCallback(
    (clientX: number, clientY: number): { u: number; v: number } | null => {
      const el = containerRef.current;
      if (!el || !view || !displayed) return null;
      const r = el.getBoundingClientRect();
      return {
        u: (clientX - r.left - view.tx) / displayed.width,
        v: (clientY - r.top - view.ty) / displayed.height,
      };
    },
    [displayed, view],
  );

  /** Pan so a region is fully visible, keeping the current zoom. */
  const ensureVisible = useCallback(
    (rect: Rect) => {
      setView((v) => {
        const el = containerRef.current;
        const cur = v ?? fitView();
        const n = natural;
        if (!cur || !el || !n) return v;
        const w = n.width * cur.scale;
        const h = n.height * cur.scale;
        const left = cur.tx + rect.x * w;
        const top = cur.ty + rect.y * h;
        const right = left + rect.w * w;
        const bottom = top + rect.h * h;
        const m = 16;
        const inside =
          left >= m && top >= m && right <= el.clientWidth - m && bottom <= el.clientHeight - m;
        if (inside) return v;
        return {
          scale: cur.scale,
          tx: el.clientWidth / 2 - (rect.x + rect.w / 2) * w,
          ty: el.clientHeight / 2 - (rect.y + rect.h / 2) * h,
        };
      });
    },
    [fitView, natural],
  );

  /** Zoom to a region and centre it (jumping in from the excerpt browser). */
  const centreOn = useCallback(
    (rect: Rect) => {
      const el = containerRef.current;
      if (!natural || !el) return;
      const scale = clamp(
        Math.min(
          (el.clientWidth * 0.6) / (rect.w * natural.width),
          (el.clientHeight * 0.6) / (rect.h * natural.height),
        ),
        MIN_SCALE,
        MAX_SCALE,
      );
      setView({
        scale,
        tx: el.clientWidth / 2 - (rect.x + rect.w / 2) * natural.width * scale,
        ty: el.clientHeight / 2 - (rect.y + rect.h / 2) * natural.height * scale,
      });
    },
    [natural],
  );

  // --- jumping in from elsewhere -------------------------------------------
  useEffect(() => {
    if (!focusExcerptId || !excerpts || !natural || box.width === 0) return;
    const region = regions.find((r) => r.id === focusExcerptId);
    if (!region) return;
    setFocusedId(focusExcerptId);
    const raf = requestAnimationFrame(() => {
      centreOn(region.rect);
      setFlashId(focusExcerptId);
    });
    const t = setTimeout(() => setFlashId((f) => (f === focusExcerptId ? null : f)), 1300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
    // Only when the target changes or the regions first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusExcerptId, !!excerpts, !!natural, box.width === 0]);

  // --- drawing, panning and clicking ---------------------------------------
  const drag = useRef<
    | { mode: "pan"; x: number; y: number }
    | { mode: "draw"; u: number; v: number; x: number; y: number }
    | null
  >(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!view || !displayed) return;
    const panning = e.button === 1 || (e.button === 0 && (e.altKey || e.shiftKey));
    if (e.button !== 0 && !panning) return;
    e.preventDefault();
    containerRef.current?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (panning) {
      drag.current = { mode: "pan", x: e.clientX, y: e.clientY };
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    if (!p) return;
    drag.current = { mode: "draw", u: p.u, v: p.v, x: e.clientX, y: e.clientY };
    setPopover(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      setView((v) => {
        const cur = v ?? fitView();
        return cur ? { ...cur, tx: cur.tx + dx, ty: cur.ty + dy } : v;
      });
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    if (p) setDraft(rectFromPoints(d.u, d.v, p.u, p.v));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || d.mode === "pan") return;
    const big =
      Math.abs(e.clientX - d.x) >= MIN_DRAG_PX && Math.abs(e.clientY - d.y) >= MIN_DRAG_PX;
    const p = toImage(e.clientX, e.clientY);
    setDraft(null);
    if (!big || !p) {
      // A click on empty space clears the selection and the focus.
      setPending(null);
      setFocusedId(null);
      return;
    }
    setPending({ documentId, kind: "image", geometry: rectFromPoints(d.u, d.v, p.u, p.v) });
  };

  /** Click a region: focus it, cycling through overlapping ones. */
  const onRegionPointerDown = (e: React.PointerEvent<SVGRectElement>, id: string) => {
    if (e.button !== 0 || e.altKey || e.shiftKey) return;
    e.stopPropagation();
    const p = toImage(e.clientX, e.clientY);
    const under = p
      ? regions.filter(
          (r) =>
            p.u >= r.rect.x &&
            p.u <= r.rect.x + r.rect.w &&
            p.v >= r.rect.y &&
            p.v <= r.rect.y + r.rect.h,
        )
      : [];
    const list = under.length ? under : regions.filter((r) => r.id === id);
    const idx = focusedId ? list.findIndex((r) => r.id === focusedId) : -1;
    const next = list[(idx + 1) % list.length] ?? list[0];
    if (!next) return;
    setDraft(null);
    setFocusedId(next.id);
    const anchor = svgRef.current?.querySelector(`[data-x="${CSS.escape(next.id)}"]`);
    setPopover(anchor ? { id: next.id, anchor } : null);
  };

  // --- keyboard -------------------------------------------------------------
  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      if (regions.length === 0) return;
      const idx = focusedId ? regions.findIndex((r) => r.id === focusedId) : -1;
      const at =
        idx === -1
          ? delta === 1
            ? 0
            : regions.length - 1
          : (idx + delta + regions.length) % regions.length;
      const next = regions[at];
      if (!next) return;
      setPopover(null);
      setFocusedId(next.id);
      ensureVisible(next.rect);
    },
    [ensureVisible, focusedId, regions, setFocusedId, setPopover],
  );

  const openPopover = useCallback((id: string) => {
    const anchor = svgRef.current?.querySelector(`[data-x="${CSS.escape(id)}"]`);
    setPopover(anchor ? { id, anchor } : null);
  }, []);

  useEffect(() => {
    return useShortcutActions.getState().register({
      nextExcerpt: () => moveFocus(1),
      prevExcerpt: () => moveFocus(-1),
      editExcerpt: () => {
        if (focusedId) openPopover(focusedId);
      },
      deleteExcerpt: () => {
        if (!focusedId) return;
        if (useSettings.getState().settings.confirmDeleteExcerpt) setConfirmDeleteId(focusedId);
        else deleteExcerpt.mutate({ id: focusedId, documentId });
      },
      escape: () => {
        const ws = useWorkspace.getState();
        if (ws.pendingSelection) {
          ws.setPendingSelection(null);
          return;
        }
        ws.setFocusedExcerptId(null);
      },
    });
  }, [deleteExcerpt, documentId, focusedId, moveFocus, openPopover]);

  const applyToPending = useCallback(
    async (codeIds: string[]) => {
      const p = useWorkspace.getState().pendingSelection;
      if (p?.kind !== "image") return;
      try {
        const r = await applyCodes.mutateAsync({
          documentId,
          kind: "image_region",
          geometry: p.geometry,
          codeIds,
        });
        setPending(null);
        setFocusedId(r.excerpt.id);
      } catch (err) {
        toast.error(err);
      }
    },
    [applyCodes, documentId, setFocusedId, setPending],
  );

  /**
   * Apply one code to whatever is the current target — a freshly drawn
   * rectangle, else the focused region. Shared by the code hotkeys and by
   * quick-code; returns whether there was anything to code.
   */
  const applyCodeToTarget = useCallback(
    (codeId: string): boolean => {
      const ws = useWorkspace.getState();
      if (ws.pendingSelection?.kind === "image" && ws.pendingSelection.documentId === documentId) {
        void applyToPending([codeId]);
        return true;
      }
      if (ws.focusedExcerptId) {
        const ex = excerptById.get(ws.focusedExcerptId);
        const rect = ex ? parseGeometry(ex.geometry) : null;
        if (!rect) return false;
        applyCodes.mutate({
          documentId,
          kind: "image_region",
          geometry: rect,
          codeIds: [codeId],
        });
        return true;
      }
      return false;
    },
    [applyCodes, applyToPending, documentId, excerptById],
  );

  const shortcutToCode = useMemo(
    () => new Map((codes ?? []).filter((c) => c.shortcut).map((c) => [c.shortcut!, c.id])),
    [codes],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTextField(e.target) || mod(e) || e.altKey) return;
      if (useWorkspace.getState().paletteOpen) return;
      if (e.key === "0") {
        e.preventDefault();
        fit();
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomCentre(1.25);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomCentre(1 / 1.25);
        return;
      }
      if (e.key.length !== 1) return;
      const codeId = shortcutToCode.get(e.key.toLowerCase());
      if (!codeId) return;
      if (applyCodeToTarget(codeId)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyCodeToTarget, fit, shortcutToCode, zoomCentre]);

  // Quick-code works over a drawn rectangle or a focused region too.
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
          toast.info("Draw a region or focus one to code it first.", {
            key: TOAST_KEYS.codeTarget,
          });
      },
    });
  }, [applyCodeToTarget]);

  // --- the floating "Code" button for a freshly drawn rectangle -------------
  const toolbarPos = useMemo(() => {
    if (!view || !displayed || pending?.kind !== "image" || pending.documentId !== documentId)
      return null;
    const r = pending.geometry;
    return {
      top: view.ty + (r.y + r.h) * displayed.height + 8,
      left: Math.max(8, view.tx + (r.x + r.w) * displayed.width - 60),
    };
  }, [displayed, documentId, pending, view]);

  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;

  const active = pending?.kind === "image" && pending.documentId === documentId ? pending : null;
  const preview = draft ?? active?.geometry ?? null;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="image-view"
      // F2 renames the open document, as in the text viewer.
      onKeyDown={(e) => {
        if (e.key !== "F2" || isTextField(e.target)) return;
        e.preventDefault();
        setRenaming(true);
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <DocumentTitle
          documentId={documentId}
          name={doc.name}
          editing={renaming}
          onEditingChange={setRenaming}
          className="min-w-0 max-w-80 truncate font-serif text-lg font-medium"
        />
        {natural ? (
          <span className="shrink-0 text-xs text-fg-muted">
            {natural.width}×{natural.height}
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="text-xs text-fg-muted">
          drag to draw a region · alt-drag to pan · scroll to zoom
        </span>
        <div className="flex items-center gap-0.5">
          <ZoomButton label="Zoom out" onClick={() => zoomCentre(1 / 1.25)}>
            <Minus className="size-3.5" />
          </ZoomButton>
          <span className="w-12 text-center text-xs tabular-nums text-fg-muted">
            {view ? Math.round(view.scale * 100) : 100}%
          </span>
          <ZoomButton label="Zoom in" onClick={() => zoomCentre(1.25)}>
            <Plus className="size-3.5" />
          </ZoomButton>
          <ZoomButton label="Fit to window" onClick={fit}>
            <Maximize2 className="size-3.5" />
          </ZoomButton>
        </div>
      </div>
      <div
        ref={containerRef}
        tabIndex={-1}
        className="relative min-h-0 flex-1 touch-none overflow-hidden bg-muted outline-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="image-canvas"
      >
        {view && displayed ? (
          <div
            className="absolute"
            style={{
              left: view.tx,
              top: view.ty,
              width: displayed.width,
              height: displayed.height,
            }}
          >
            <img
              src={mediaUrl(documentId)}
              alt={doc.name}
              draggable={false}
              className="block size-full select-none"
              style={{ imageRendering: view.scale > 2 ? "pixelated" : undefined }}
            />
            <svg
              ref={svgRef}
              className="absolute inset-0 size-full overflow-visible"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              data-testid="image-regions"
            >
              {regions.map((r) => {
                const focused = r.id === focusedId;
                const flash = r.id === flashId;
                return (
                  <rect
                    key={r.id}
                    data-x={r.id}
                    x={r.rect.x}
                    y={r.rect.y}
                    width={r.rect.w}
                    height={r.rect.h}
                    fill={r.color}
                    fillOpacity={focused ? 0.3 : r.codeCount === 0 ? 0.08 : 0.16}
                    stroke={focused || flash ? "var(--focus)" : r.color}
                    strokeWidth={focused || flash ? 2 : 1.25}
                    vectorEffect="non-scaling-stroke"
                    className={flash ? "region-flash" : undefined}
                    style={{ cursor: "pointer" }}
                    onPointerDown={(e) => onRegionPointerDown(e, r.id)}
                  />
                );
              })}
              {preview ? (
                <rect
                  x={preview.x}
                  y={preview.y}
                  width={preview.w}
                  height={preview.h}
                  fill="var(--accent)"
                  fillOpacity={0.14}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  data-testid="image-draft"
                />
              ) : null}
            </svg>
          </div>
        ) : null}
        {toolbarPos ? (
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
              if (useSettings.getState().settings.confirmDeleteExcerpt) setConfirmDeleteId(id);
              else deleteExcerpt.mutate({ id, documentId });
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

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
