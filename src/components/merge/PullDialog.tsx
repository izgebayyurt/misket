import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Trans, useTranslation } from "react-i18next";
import { getE2eConfig } from "@/api/e2e";
import { mergePreview } from "@/api/merge";
import type { MergeConflict, MergeCount, MergePlan, MergeReport } from "@/api/types";
import { initialsOf } from "@/core/coders";
import { describe } from "@/core/keymap";
import { usePullFromCopy } from "@/queries/merge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

/**
 * The file picker every "another copy" path comes from — unless the app was
 * launched with `MISKET_E2E_PULL`, which names one so the smoke test never
 * has to drive a native file chooser (see `src-tauri/src/commands/e2e.rs`).
 */
async function pickAnotherCopy(t: (key: string) => string): Promise<string | null> {
  const configured = await getE2eConfig().catch(() => null);
  if (configured?.pullPath) return configured.pullPath;
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: t("common.fileFilters.misketProject"), extensions: ["misket"] }],
  });
  return typeof picked === "string" ? picked : null;
}

const ROWS: { labelKey: string; of: (p: MergePlan) => MergeCount }[] = [
  { labelKey: "merge.pull.rows.documents", of: (p) => p.documents },
  { labelKey: "merge.pull.rows.codes", of: (p) => p.codes },
  { labelKey: "merge.pull.rows.excerpts", of: (p) => p.excerpts },
  { labelKey: "merge.pull.rows.codings", of: (p) => p.codings },
  { labelKey: "merge.pull.rows.memos", of: (p) => p.memos },
  { labelKey: "merge.pull.rows.descriptorValues", of: (p) => p.descriptorValues },
  { labelKey: "merge.pull.rows.sets", of: (p) => p.sets },
  { labelKey: "merge.pull.rows.filters", of: (p) => p.filters },
  { labelKey: "merge.pull.rows.frameworkCells", of: (p) => p.frameworkCells },
];

function nothingToDo(plan: MergePlan) {
  return plan.conflicts.length === 0 && ROWS.every((r) => r.of(plan).new === 0);
}

/**
 * What the toast names after a pull. Built from the report's own counts
 * (never from `report.summary`, which the Rust side always writes in
 * English for the activity log — see `merge::apply`'s `summarize`) so the
 * toast follows the active UI language.
 */
const REPORT_UNITS: { key: string; get: (r: MergeReport) => number }[] = [
  { key: "codings", get: (r) => r.codings },
  { key: "excerpts", get: (r) => r.excerpts },
  { key: "codes", get: (r) => r.codes },
  { key: "documents", get: (r) => r.documents },
  { key: "memos", get: (r) => r.memos },
];

/**
 * Every `merge.pull.units.*` key built at runtime (`` `merge.pull.units.${u.key}` ``
 * in `confirm`), written out literally and never called: `scripts/i18n-extract.mjs`
 * only finds string literals, so this keeps them checked as "used" instead of
 * reading as dead. Keep in sync with `REPORT_UNITS`.
 */
function _pullUnitKeysForExtraction(t: (key: string, params?: Record<string, unknown>) => string) {
  t("merge.pull.units.codings", { count: 1 });
  t("merge.pull.units.excerpts", { count: 1 });
  t("merge.pull.units.codes", { count: 1 });
  t("merge.pull.units.documents", { count: 1 });
  t("merge.pull.units.memos", { count: 1 });
}
void _pullUnitKeysForExtraction;

/**
 * Pull another researcher's copy of the project into this one.
 *
 * Three steps in one dialog: pick the file, read the preview, answer whatever
 * the two copies disagree about. Nothing is written until "Pull", nothing is
 * ever written to the other file, and the whole thing is one undo.
 */
export function PullDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(null);
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const pull = usePullFromCopy();

  // Opening the dialog goes straight to the picker: choosing a file is the
  // whole of step one, and an empty dialog has nothing to say.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const picked = await pickAnotherCopy(t);
      if (cancelled) return;
      if (!picked) {
        onClose();
        return;
      }
      setPath(picked);
      setLoading(true);
      try {
        const next = await mergePreview(picked);
        if (cancelled) return;
        setPlan(next);
        setChoices(Object.fromEntries(next.conflicts.map((c) => [c.id, c.default])));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onClose, t]);

  const fileName = useMemo(() => path?.split(/[\\/]/).pop() ?? "", [path]);

  async function confirm() {
    if (!path || !plan) return;
    try {
      const report = await pull.mutateAsync({
        path,
        decisions: Object.entries(choices).map(([conflictId, choice]) => ({
          conflictId,
          choice,
        })),
      });
      const what = REPORT_UNITS.filter((u) => u.get(report) > 0)
        .map((u) => t(`merge.pull.units.${u.key}`, { count: u.get(report) }))
        .join(", ");
      toast.info(
        report.codings > 0 || report.excerpts > 0 || report.codes > 0 || report.documents > 0
          ? t("merge.pull.toastPulled", {
              what,
              name: report.otherName,
              shortcut: describe("undo"),
            })
          : t("merge.pull.toastNothingNew", { name: report.otherName }),
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
        title={t("merge.pull.title")}
        description={
          plan
            ? t("merge.pull.descriptionWithPlan", { name: plan.otherName })
            : t("merge.pull.descriptionNoPlan")
        }
        data-testid="pull-dialog"
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-fg-muted">{t("merge.pull.reading", { fileName })}</p>
          ) : null}

          {error ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          {plan ? (
            <>
              {!plan.sameProject ? (
                <p
                  className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm"
                  data-testid="pull-different-project"
                >
                  <Trans
                    i18nKey="merge.pull.differentProject"
                    components={{ bold: <span className="font-medium" /> }}
                  />
                </p>
              ) : null}

              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-2 font-medium">
                  {t("merge.pull.fromCopy", { name: plan.otherName })}
                </p>
                {nothingToDo(plan) ? (
                  <p className="text-fg-muted" data-testid="pull-nothing">
                    {t("merge.pull.nothingNewHint", { fileName })}
                  </p>
                ) : (
                  <ul className="space-y-0.5" data-testid="pull-counts">
                    {ROWS.filter((r) => r.of(plan).new > 0).map((r) => {
                      const c = r.of(plan);
                      return (
                        <li key={r.labelKey} className="flex gap-2">
                          <span className="w-10 shrink-0 text-right font-medium tabular-nums">
                            {c.new}
                          </span>
                          <span>
                            {t("merge.pull.newRow", { label: t(r.labelKey) })}
                            {c.matched + c.byName > 0 ? (
                              <span className="text-fg-muted">
                                {" "}
                                {t("merge.pull.alreadyHere", { count: c.matched + c.byName })}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {plan.otherCoders.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-fg-muted">
                    {t("merge.pull.whoCodedWhat")}
                  </p>
                  <ul className="space-y-1 text-sm" data-testid="pull-coders">
                    {plan.otherCoders.map((c) => (
                      <li key={c.id} className="flex items-center gap-2">
                        <span
                          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold leading-none text-white"
                          style={{ background: c.color }}
                        >
                          {initialsOf(c.name)}
                        </span>
                        <span className="truncate">
                          {c.name}
                          {c.isLocal ? ` ${t("merge.pull.youSuffix")}` : ""}
                        </span>
                        <span className="ml-auto shrink-0 tabular-nums text-fg-muted">
                          {t("merge.pull.comingOver", {
                            incoming: c.incomingCount,
                            total: c.codingCount,
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plan.conflicts.length > 0 ? (
                <div className="space-y-3" data-testid="pull-conflicts">
                  <p className="text-xs font-medium text-fg-muted">
                    {t("merge.pull.conflictsHeading", { count: plan.conflicts.length })}
                  </p>
                  {plan.conflicts.map((c) => (
                    <ConflictRow
                      key={c.id}
                      conflict={c}
                      chosen={choices[c.id] ?? c.default}
                      onChoose={(choice) => setChoices((prev) => ({ ...prev, [c.id]: choice }))}
                      theirName={plan.otherName}
                    />
                  ))}
                </div>
              ) : null}

              {plan.notes.length > 0 ? (
                <ul
                  className="list-disc space-y-1 pl-5 text-xs text-fg-muted"
                  data-testid="pull-notes"
                >
                  {plan.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!plan || pull.isPending || nothingToDo(plan ?? ({} as MergePlan))}
            onClick={() => void confirm()}
            data-testid="pull-confirm"
          >
            {t("merge.pull.pull")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConflictRow({
  conflict,
  chosen,
  onChoose,
  theirName,
}: {
  conflict: MergeConflict;
  chosen: string;
  onChoose: (choice: string) => void;
  theirName: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-border p-3 text-sm" data-conflict-id={conflict.id}>
      <p className="font-medium">{conflict.title}</p>
      {conflict.field ? <p className="text-xs text-fg-muted">{conflict.field}</p> : null}
      <dl className="mt-2 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-fg-muted">{t("merge.pull.yours")}</dt>
        <dd className="break-words">
          {conflict.ours || <em className="text-fg-muted">{t("merge.pull.empty")}</em>}
        </dd>
        <dt className="truncate text-fg-muted">{theirName}</dt>
        <dd className="break-words">
          {conflict.theirs || <em className="text-fg-muted">{t("merge.pull.empty")}</em>}
        </dd>
      </dl>
      <div className="mt-2 space-y-1">
        {conflict.choices.map(([id, label]) => (
          <label key={id} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-0.5"
              name={conflict.id}
              checked={chosen === id}
              onChange={() => onChoose(id)}
            />
            <span className={cn(chosen === id && "font-medium")}>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
