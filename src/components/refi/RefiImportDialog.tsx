import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { getE2eConfig } from "@/api/e2e";
import { refiPreview } from "@/api/refi";
import type { RefiImportMode, RefiImportReport, RefiPreview } from "@/api/types";
import { describe } from "@/core/keymap";
import { useImportRefi } from "@/queries/refi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

/**
 * The file picker, unless the app was launched with `MISKET_E2E_REFI`, which
 * names one so the smoke test never has to drive a native file chooser
 * (see `src-tauri/src/commands/e2e.rs`).
 */
async function pickQdpx(): Promise<string | null> {
  const configured = await getE2eConfig().catch(() => null);
  if (configured?.refiPath) return configured.refiPath;
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "REFI-QDA project", extensions: ["qdpx"] }],
  });
  return typeof picked === "string" ? picked : null;
}

const ROWS: { labelKey: string; of: (p: RefiPreview) => number }[] = [
  { labelKey: "refi.import.rows.textSources", of: (p) => p.textSources },
  { labelKey: "refi.import.rows.pictures", of: (p) => p.pictureSources },
  { labelKey: "refi.import.rows.codes", of: (p) => p.codes },
  { labelKey: "refi.import.rows.codings", of: (p) => p.codings },
  { labelKey: "refi.import.rows.users", of: (p) => p.users },
  { labelKey: "refi.import.rows.notes", of: (p) => p.notes },
  { labelKey: "refi.import.rows.variables", of: (p) => p.variables },
  { labelKey: "refi.import.rows.sets", of: (p) => p.sets },
];

function nothingToDo(preview: RefiPreview) {
  return ROWS.every((r) => r.of(preview) === 0);
}

/**
 * What the toast names after an import. Built from the report's own counts
 * (never from `report.summary`, which the Rust side always writes in
 * English for the activity log — see `refi::apply`'s `summarize_import`) so
 * the toast follows the active UI language.
 */
const REPORT_UNITS: { key: string; get: (r: RefiImportReport) => number }[] = [
  { key: "documents", get: (r) => r.documents },
  { key: "codes", get: (r) => r.codes },
  { key: "excerpts", get: (r) => r.excerpts },
  { key: "codings", get: (r) => r.codings },
  { key: "memos", get: (r) => r.memos },
];

/**
 * Every `refi.import.units.*` key built at runtime (`` `refi.import.units.${u.key}` ``
 * in `confirm`), written out literally and never called: `scripts/i18n-extract.mjs`
 * only finds string literals, so this keeps them checked as "used" instead of
 * reading as dead. Keep in sync with `REPORT_UNITS`.
 */
function _refiUnitKeysForExtraction(t: (key: string, params?: Record<string, unknown>) => string) {
  t("refi.import.units.documents", { count: 1 });
  t("refi.import.units.codes", { count: 1 });
  t("refi.import.units.excerpts", { count: 1 });
  t("refi.import.units.codings", { count: 1 });
  t("refi.import.units.memos", { count: 1 });
}
void _refiUnitKeysForExtraction;

/**
 * Import a REFI-QDA `.qdpx` written by NVivo, ATLAS.ti, MAXQDA, QualCoder
 * and the rest.
 *
 * Three steps in one dialog: pick the file, read what is in it, choose
 * whether to merge it into this project or take it as the project. Nothing
 * is written until "Import", and the whole import is one undo.
 */
export function RefiImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<RefiPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<RefiImportMode>("merge");
  const runImport = useImportRefi();

  // Opening the dialog goes straight to the picker: choosing a file is the
  // whole of step one, and an empty dialog has nothing to say.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const picked = await pickQdpx();
      if (cancelled) return;
      if (!picked) {
        onClose();
        return;
      }
      setPath(picked);
      setLoading(true);
      try {
        const next = await refiPreview(picked);
        if (cancelled) return;
        setPreview(next);
        setMode(next.projectHasContent ? "merge" : "replace");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onClose]);

  const fileName = useMemo(() => path?.split(/[\\/]/).pop() ?? "", [path]);

  async function confirm() {
    if (!path || !preview) return;
    try {
      const report = await runImport.mutateAsync({ path, mode });
      const what = REPORT_UNITS.filter((u) => u.get(report) > 0)
        .map((u) => t(`refi.import.units.${u.key}`, { count: u.get(report) }))
        .join(", ");
      toast.info(
        what
          ? t("refi.import.toastImported", {
              label: report.projectName,
              what,
              shortcut: describe("undo"),
            })
          : t("refi.import.toastImportedNothingNew", {
              label: report.projectName,
              shortcut: describe("undo"),
            }),
      );
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl"
        title={t("refi.import.title")}
        description={
          preview
            ? t("refi.import.descriptionWithPreview", {
                fileName,
                origin: preview.origin || t("refi.import.unnamedTool"),
              })
            : t("refi.import.descriptionNoPreview")
        }
        data-testid="refi-import-dialog"
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-fg-muted">{t("refi.import.reading", { fileName })}</p>
          ) : null}

          {error ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          {preview ? (
            <>
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-2 font-medium">
                  {preview.projectName || t("refi.import.unnamedProject")}
                </p>
                {nothingToDo(preview) ? (
                  <p className="text-fg-muted" data-testid="refi-nothing">
                    {t("refi.import.nothingToImport", { fileName })}
                  </p>
                ) : (
                  <ul className="space-y-0.5" data-testid="refi-counts">
                    {ROWS.filter((r) => r.of(preview) > 0).map((r) => (
                      <li key={r.labelKey} className="flex gap-2">
                        <span className="w-10 shrink-0 text-right font-medium tabular-nums">
                          {r.of(preview)}
                        </span>
                        <span>{t(r.labelKey)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <fieldset className="space-y-2" data-testid="refi-mode">
                <legend className="mb-1 text-xs font-medium text-fg-muted">
                  {t("refi.import.modeLegend")}
                </legend>
                {(
                  [
                    [
                      "merge",
                      t("refi.import.modeMergeTitle"),
                      t("refi.import.modeMergeHint"),
                      true,
                    ],
                    [
                      "replace",
                      t("refi.import.modeReplaceTitle"),
                      preview.projectHasContent
                        ? t("refi.import.modeReplaceDisabledHint")
                        : t("refi.import.modeReplaceHint"),
                      !preview.projectHasContent,
                    ],
                  ] as [RefiImportMode, string, string, boolean][]
                ).map(([id, title, hint, enabled]) => (
                  <label
                    key={id}
                    // The label's text lives two spans deep, past what
                    // eslint-plugin-jsx-a11y's static check can see; naming it
                    // explicitly also keeps the announced name to the option's
                    // title, not the hint below it.
                    aria-label={title}
                    className={cn(
                      "flex items-start gap-2 text-sm",
                      !enabled && "text-fg-muted opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      name="refi-mode"
                      value={id}
                      disabled={!enabled}
                      checked={mode === id}
                      onChange={() => setMode(id)}
                    />
                    <span>
                      <span className={cn(mode === id && "font-medium")}>{title}</span>
                      <span className="block text-xs text-fg-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {preview.unsupported.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-fg-muted">
                    {t("refi.import.unsupportedHeading")}
                  </p>
                  <ul
                    className="list-disc space-y-1 pl-5 text-xs text-fg-muted"
                    data-testid="refi-unsupported"
                  >
                    {preview.unsupported.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!preview || runImport.isPending || (preview ? nothingToDo(preview) : true)}
            onClick={() => void confirm()}
            data-testid="refi-import-confirm"
          >
            {t("documents.importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
