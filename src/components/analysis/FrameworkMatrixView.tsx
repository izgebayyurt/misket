import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { FileText, Plus, Settings2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FrameworkMatrix, FrameworkMatrixInput, FrameworkRow } from "@/api/types";
import { writeTextFile } from "@/api/project";
import { pathOf } from "@/core/codeTree";
import { matrixCsv } from "@/core/csv";
import { markdownTable } from "@/core/markdown";
import { useCodeTree } from "@/queries/codes";
import { useExcerptQuery } from "@/queries/excerpts";
import {
  useCreateFrameworkMatrix,
  useDeleteFrameworkMatrix,
  useFrameworkMatrices,
  useFrameworkMatrix,
  useSetFrameworkCell,
  useUpdateFrameworkMatrix,
} from "@/queries/framework";
import { useProjectInfo } from "@/queries/project";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { ExcerptRow } from "@/components/excerpts/ExcerptRow";
import { Button } from "@/components/ui/button";
import { toast } from "@/state/toasts";
import { useWorkspace } from "@/state/workspace";
import { FrameworkMatrixDialog } from "./FrameworkMatrixDialog";
import { AnalysisToolbar, EmptyNote, ExportCsvButton } from "./shared";

/** How long typing pauses before a summary is saved (as in `MemoEditor`). */
const SAVE_DELAY = 500;

const cellId = (row: number, column: number) => `framework-cell-${row}-${column}`;

/** The configuration of an existing matrix, as the dialog and undo take it. */
function configOf(m: FrameworkMatrix): FrameworkMatrixInput {
  return {
    name: m.name,
    rowKind: m.rowKind,
    rowFieldId: m.rowFieldId,
    rowSetId: m.rowSetId,
    codeSetId: m.codeSetId,
    codeIds: m.codeIds,
  };
}

/**
 * A framework matrix (Ritchie & Spencer): cases down the side, themes across
 * the top, and a written summary in every cell with its evidence one click
 * away in the drawer.
 */
export function FrameworkMatrixView() {
  const { t } = useTranslation();
  const { data: matrices, isPending: listPending } = useFrameworkMatrices();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  const [evidence, setEvidence] = useState<{ rowKey: string; codeId: string } | null>(null);

  // A matrix that was deleted (or undone back into existence) must not leave
  // the picker pointing at nothing.
  const current =
    (pickedId ? matrices?.find((m) => m.id === pickedId) : undefined) ?? matrices?.[0] ?? null;
  const { data: view } = useFrameworkMatrix(current?.id ?? null);

  const tree = useCodeTree();
  const create = useCreateFrameworkMatrix();
  const update = useUpdateFrameworkMatrix();
  const del = useDeleteFrameworkMatrix();
  const { data: project } = useProjectInfo();

  const rows = useMemo(() => view?.rows ?? [], [view]);
  const columns = useMemo(() => view?.columns ?? [], [view]);
  const summaries = useMemo(() => {
    const map = new Map<string, { summary: string; count: number }>();
    for (const c of view?.cells ?? [])
      map.set(`${c.rowKey}|${c.codeId}`, { summary: c.summary, count: c.excerptCount });
    return map;
  }, [view]);
  const at = useCallback(
    (rowKey: string, codeId: string) =>
      summaries.get(`${rowKey}|${codeId}`) ?? { summary: "", count: 0 },
    [summaries],
  );

  // The grid is a flat list of textareas addressed by (row, column), so a
  // move is just "focus the one at these coordinates".
  const focusCell = useCallback(
    (row: number, column: number) => {
      if (row < 0 || column < 0 || row >= rows.length || column >= columns.length) return false;
      document.getElementById(cellId(row, column))?.focus();
      return true;
    },
    [rows.length, columns.length],
  );

  const evidenceRow = evidence ? rows.find((r) => r.rowKey === evidence.rowKey) : undefined;

  const columnLabels = columns.map((id) => pathOf(tree, id));
  const exportRows = rows.map((r) => ({
    label: r.label,
    values: columns.map((id) => at(r.rowKey, id).summary),
  }));
  const written = (view?.cells ?? []).filter((c) => c.summary.trim()).length;

  async function exportMarkdown() {
    if (!current) return;
    try {
      const stem = (project?.name ?? "misket").replace(/[^\w.-]+/g, "_") || "misket";
      const path = await save({
        defaultPath: `${stem}-${current.name.replace(/[^\w.-]+/g, "_")}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(
        path,
        `# ${current.name}\n\n${markdownTable(current.name, columnLabels, exportRows)}\n`,
      );
      toast.info(t("analysis.exportedTo", { name: path.split(/[\\/]/).pop() }));
    } catch (e) {
      toast.error(e);
    }
  }

  const toolbar = (
    <AnalysisToolbar>
      <select
        className="h-7 max-w-56 rounded-md border border-border bg-panel px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus"
        value={current?.id ?? ""}
        onChange={(e) => setPickedId(e.target.value)}
        aria-label={t("analysis.framework.matrixPicker")}
        data-testid="framework-picker"
      >
        {matrices?.length ? null : (
          <option value="">{t("analysis.framework.noMatricesYet")}</option>
        )}
        {matrices?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDialog("new")}
        data-testid="framework-new"
      >
        <Plus /> {t("analysis.framework.new")}
      </Button>
      {current ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDialog("edit")}
            data-testid="framework-configure"
          >
            <Settings2 /> {t("analysis.framework.configure")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => del.mutateAsync(current).catch(toast.error)}
            data-testid="framework-delete"
          >
            <Trash2 /> {t("common.delete")}
          </Button>
          <span className="text-xs text-fg-muted">
            {t("analysis.framework.gridSummary", {
              rows: t("analysis.framework.rowCount", { count: rows.length }),
              themes: t("analysis.framework.themeCount", { count: columns.length }),
              written,
            })}
          </span>
          <span className="ml-auto" />
          <Button
            variant="outline"
            size="sm"
            onClick={exportMarkdown}
            disabled={!rows.length || !columns.length}
            data-testid="export-markdown"
          >
            <FileText /> {t("analysis.framework.markdown")}
          </Button>
          <ExportCsvButton
            name="framework"
            build={() => matrixCsv(current.name, columnLabels, exportRows)}
            disabled={!rows.length || !columns.length}
          />
        </>
      ) : null}
    </AnalysisToolbar>
  );

  return (
    <div className="flex h-full flex-col" data-testid="analysis-framework">
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {!current ? (
            <EmptyNote>
              {listPending ? t("analysis.framework.loading") : t("analysis.framework.introEmpty")}
            </EmptyNote>
          ) : !rows.length || !columns.length ? (
            <EmptyNote>
              {!columns.length
                ? t("analysis.framework.noThemesYet")
                : t("analysis.framework.noCasesMatch")}
            </EmptyNote>
          ) : (
            <Grid
              matrixId={current.id}
              rows={rows}
              columns={columns}
              at={at}
              onEvidence={setEvidence}
              focusCell={focusCell}
            />
          )}
        </div>
        {evidence && evidenceRow ? (
          <EvidenceDrawer
            row={evidenceRow}
            codeId={evidence.codeId}
            onClose={() => setEvidence(null)}
          />
        ) : null}
      </div>
      {dialog ? (
        <FrameworkMatrixDialog
          matrix={dialog === "edit" ? current : null}
          onClose={() => setDialog(null)}
          onSubmit={(input) => {
            setDialog(null);
            if (dialog === "edit" && current)
              update
                .mutateAsync({ id: current.id, input, previous: configOf(current) })
                .catch(toast.error);
            else
              create
                .mutateAsync(input)
                .then((m) => m && setPickedId(m.id))
                .catch(toast.error);
          }}
        />
      ) : null}
    </div>
  );
}

function Grid({
  matrixId,
  rows,
  columns,
  at,
  onEvidence,
  focusCell,
}: {
  matrixId: string;
  rows: FrameworkRow[];
  columns: string[];
  at: (rowKey: string, codeId: string) => { summary: string; count: number };
  onEvidence: (cell: { rowKey: string; codeId: string }) => void;
  focusCell: (row: number, column: number) => boolean;
}) {
  const { t } = useTranslation();
  const tree = useCodeTree();
  return (
    <>
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-44 min-w-44 border-b border-r border-border bg-bg p-2 text-left text-xs font-medium text-fg-muted">
              {t("analysis.framework.caseColumn")}
            </th>
            {columns.map((id) => (
              <th
                key={id}
                scope="col"
                className="sticky top-0 z-20 w-64 min-w-64 border-b border-r border-border bg-bg p-2 text-left font-medium"
                title={pathOf(tree, id)}
              >
                <span className="flex items-center gap-1.5">
                  <ColorDot color={tree.byId.get(id)?.code.color ?? "#999"} />
                  <span className="truncate">{tree.byId.get(id)?.code.name ?? "?"}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.rowKey}>
              <th
                scope="row"
                className="sticky left-0 z-10 w-44 min-w-44 border-b border-r border-border bg-bg p-2 text-left align-top font-normal"
                title={row.label}
              >
                <span className="block truncate">{row.label}</span>
                {row.documentIds.length > 1 ? (
                  <span className="block text-xs text-fg-muted">
                    {t("excerpts.filters.documentCount", { count: row.documentIds.length })}
                  </span>
                ) : null}
              </th>
              {columns.map((codeId, c) => {
                const { summary, count } = at(row.rowKey, codeId);
                return (
                  <td
                    key={codeId}
                    className="w-64 min-w-64 border-b border-r border-border p-0 align-top"
                  >
                    <SummaryCell
                      id={cellId(r, c)}
                      matrixId={matrixId}
                      rowKey={row.rowKey}
                      codeId={codeId}
                      label={`${row.label} × ${pathOf(tree, codeId)}`}
                      summary={summary}
                      count={count}
                      onEvidence={() => onEvidence({ rowKey: row.rowKey, codeId })}
                      onMove={(dr, dc) => focusCell(r + dr, c + dc)}
                      onStep={(delta) => {
                        const next = r * columns.length + c + delta;
                        if (next < 0 || next >= rows.length * columns.length) return false;
                        return focusCell(Math.floor(next / columns.length), next % columns.length);
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="max-w-prose p-3 text-xs text-fg-muted">{t("analysis.framework.gridHint")}</p>
    </>
  );
}

/**
 * One cell: an auto-growing textarea that saves after a pause and on blur,
 * exactly like `MemoEditor`, with the excerpt count as a badge.
 */
function SummaryCell({
  id,
  matrixId,
  rowKey,
  codeId,
  label,
  summary,
  count,
  onEvidence,
  onMove,
  onStep,
}: {
  id: string;
  matrixId: string;
  rowKey: string;
  codeId: string;
  label: string;
  summary: string;
  count: number;
  onEvidence: () => void;
  /** Move the focus by whole rows/columns; false if there is nowhere to go. */
  onMove: (rowDelta: number, columnDelta: number) => boolean;
  /** Move the focus one cell forward (1) or back (-1) in reading order. */
  onStep: (delta: number) => boolean;
}) {
  const { t } = useTranslation();
  const setCell = useSetFrameworkCell();
  const [text, setText] = useState(summary);
  const timer = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const latest = useRef(text);
  const dirty = useRef(false);

  // An edit somewhere else (undo, a redo, another cell) is only allowed to
  // overwrite what is on screen while this cell has nothing unsaved.
  useEffect(() => {
    if (!dirty.current) setText(summary);
  }, [summary]);
  useEffect(() => {
    latest.current = text;
    const el = area.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
    }
  }, [text]);

  const save = useCallback(
    (value: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      dirty.current = false;
      if (value === summary) return;
      setCell
        .mutateAsync({
          matrixId,
          rowKey,
          codeId,
          summary: value,
          label: t("analysis.framework.summaryLabel", { label }),
        })
        .catch(toast.error);
    },
    [matrixId, rowKey, codeId, summary, label, setCell, t],
  );
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Flush a pending save when the cell goes away (the matrix changed, the
  // view closed), so nothing typed is silently lost.
  useEffect(() => {
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        saveRef.current(latest.current);
      }
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      onEvidence();
      return;
    }
    if (mod) {
      const moved =
        e.key === "ArrowRight"
          ? onMove(0, 1)
          : e.key === "ArrowLeft"
            ? onMove(0, -1)
            : e.key === "ArrowDown"
              ? onMove(1, 0)
              : e.key === "ArrowUp"
                ? onMove(-1, 0)
                : false;
      if (moved) {
        e.preventDefault();
        save(latest.current);
      }
      return;
    }
    // Tab walks the grid in reading order; at either end it falls through to
    // the browser, so the grid is not a keyboard trap.
    if (e.key === "Tab" && onStep(e.shiftKey ? -1 : 1)) {
      e.preventDefault();
      save(latest.current);
    }
  }

  return (
    <div className="group relative">
      <textarea
        id={id}
        ref={area}
        value={text}
        rows={2}
        placeholder={t("analysis.framework.summarisePlaceholder")}
        aria-label={t("analysis.framework.summaryFor", {
          label,
          excerpts: t("analysis.framework.excerptCount", { count }),
        })}
        className="block max-h-64 w-full resize-none overflow-y-auto bg-transparent p-2 pr-10 text-sm leading-snug outline-none placeholder:text-fg-muted/60 focus:bg-accent/5 focus-visible:ring-1 focus-visible:ring-focus"
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
          if (timer.current) window.clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = window.setTimeout(() => saveRef.current(value), SAVE_DELAY);
        }}
        onBlur={() => save(text)}
        onKeyDown={onKeyDown}
        data-testid="framework-cell"
      />
      <button
        className={
          "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[11px] tabular-nums " +
          (count
            ? "bg-accent/15 text-fg hover:bg-accent/30"
            : "text-fg-muted/60 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")
        }
        tabIndex={-1}
        title={t("analysis.framework.excerptsBehindCell", { count })}
        aria-label={t("analysis.framework.showExcerptsFor", {
          excerpts: t("analysis.framework.excerptCount", { count }),
          label,
        })}
        onClick={onEvidence}
        data-testid="framework-evidence"
      >
        {count}
      </button>
    </div>
  );
}

/**
 * The evidence for one cell, beside the grid rather than in a new view, so
 * the summary can be written while reading. Rows are the excerpt browser's.
 */
function EvidenceDrawer({
  row,
  codeId,
  onClose,
}: {
  row: FrameworkRow;
  codeId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tree = useCodeTree();
  const openDocument = useWorkspace((s) => s.openDocument);
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const filter = useMemo(
    () => ({
      codeIds: [codeId],
      documentIds: row.documentIds,
      includeDescendants: true,
      limit: 200,
    }),
    [codeId, row.documentIds],
  );
  const { data } = useExcerptQuery(filter);
  const rows = data?.rows ?? [];

  return (
    <aside
      className="flex w-96 shrink-0 flex-col border-l border-border bg-panel"
      data-testid="framework-drawer"
    >
      <div className="flex items-start gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.label}</p>
          <p className="truncate text-xs text-fg-muted">{pathOf(tree, codeId)}</p>
        </div>
        <button
          className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
          aria-label={t("analysis.framework.closeEvidence")}
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && rows.length === 0 ? (
          <p className="p-4 text-sm text-fg-muted">{t("analysis.framework.nothingCodedYet")}</p>
        ) : null}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <ExcerptRow key={r.id} row={r} onOpen={() => openDocument(r.documentId, r.id)} />
          ))}
        </ul>
        {data && data.total > rows.length ? (
          <div className="p-3">
            <Button variant="outline" size="sm" onClick={() => openExcerpts(filter)}>
              {t("analysis.framework.openAllInBrowser", { count: data.total })}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
