import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { mergePreview } from "@/api/merge";
import type { MergeConflict, MergeCount, MergePlan } from "@/api/types";
import { initialsOf } from "@/core/coders";
import { describe } from "@/core/keymap";
import { usePullFromCopy } from "@/queries/merge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

/** The file picker every "another copy" path comes from. */
async function pickAnotherCopy(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Misket project", extensions: ["misket"] }],
  });
  return typeof picked === "string" ? picked : null;
}

const ROWS: { label: string; of: (p: MergePlan) => MergeCount }[] = [
  { label: "documents", of: (p) => p.documents },
  { label: "codes", of: (p) => p.codes },
  { label: "excerpts", of: (p) => p.excerpts },
  { label: "codings", of: (p) => p.codings },
  { label: "memos", of: (p) => p.memos },
  { label: "document attributes", of: (p) => p.descriptorValues },
  { label: "sets", of: (p) => p.sets },
  { label: "saved filters", of: (p) => p.filters },
  { label: "framework summaries", of: (p) => p.frameworkCells },
];

function nothingToDo(plan: MergePlan) {
  return plan.conflicts.length === 0 && ROWS.every((r) => r.of(plan).new === 0);
}

/**
 * Pull another researcher's copy of the project into this one.
 *
 * Three steps in one dialog: pick the file, read the preview, answer whatever
 * the two copies disagree about. Nothing is written until "Pull", nothing is
 * ever written to the other file, and the whole thing is one undo.
 */
export function PullDialog({ onClose }: { onClose: () => void }) {
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
      const picked = await pickAnotherCopy();
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
  }, [onClose]);

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
      const what =
        report.codings > 0
          ? `${report.codings} coding${report.codings === 1 ? "" : "s"}`
          : report.summary.replace(/^Pulled from .*?: /, "");
      toast.info(
        report.codings > 0 || report.excerpts > 0 || report.codes > 0 || report.documents > 0
          ? `Pulled ${what} by ${report.otherName}; undo with ${describe("undo")}`
          : `Nothing new in ${report.otherName}'s copy`,
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
        title="Pull from another copy"
        description={
          plan
            ? `Everything ${plan.otherName} has and you do not, added to this project. Nothing of yours is removed, and nothing is written to their file.`
            : "Choose another researcher's copy of this project."
        }
        data-testid="pull-dialog"
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {loading ? <p className="text-sm text-fg-muted">Reading {fileName}…</p> : null}

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
                  <span className="font-medium">This is a different project</span>, not another copy
                  of this one. Everything in it will arrive as new material.
                </p>
              ) : null}

              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-2 font-medium">From {plan.otherName}'s copy</p>
                {nothingToDo(plan) ? (
                  <p className="text-fg-muted" data-testid="pull-nothing">
                    Nothing new — you already have everything in {fileName}.
                  </p>
                ) : (
                  <ul className="space-y-0.5" data-testid="pull-counts">
                    {ROWS.filter((r) => r.of(plan).new > 0).map((r) => {
                      const c = r.of(plan);
                      return (
                        <li key={r.label} className="flex gap-2">
                          <span className="w-10 shrink-0 text-right font-medium tabular-nums">
                            {c.new}
                          </span>
                          <span>
                            new {r.label}
                            {c.matched + c.byName > 0 ? (
                              <span className="text-fg-muted">
                                {" "}
                                ({c.matched + c.byName} already here)
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
                  <p className="mb-1 text-xs font-medium text-fg-muted">Who coded what</p>
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
                          {c.isLocal ? " (you)" : ""}
                        </span>
                        <span className="ml-auto shrink-0 tabular-nums text-fg-muted">
                          {c.incomingCount} of {c.codingCount} coming over
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plan.conflicts.length > 0 ? (
                <div className="space-y-3" data-testid="pull-conflicts">
                  <p className="text-xs font-medium text-fg-muted">
                    You have both changed {plan.conflicts.length === 1 ? "this" : "these"} — pick
                    what to keep
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
            Cancel
          </Button>
          <Button
            disabled={!plan || pull.isPending || nothingToDo(plan ?? ({} as MergePlan))}
            onClick={() => void confirm()}
            data-testid="pull-confirm"
          >
            Pull
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
  return (
    <div className="rounded-md border border-border p-3 text-sm" data-conflict-id={conflict.id}>
      <p className="font-medium">{conflict.title}</p>
      {conflict.field ? <p className="text-xs text-fg-muted">{conflict.field}</p> : null}
      <dl className="mt-2 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-fg-muted">Yours</dt>
        <dd className="break-words">{conflict.ours || <em className="text-fg-muted">empty</em>}</dd>
        <dt className="truncate text-fg-muted">{theirName}</dt>
        <dd className="break-words">
          {conflict.theirs || <em className="text-fg-muted">empty</em>}
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
