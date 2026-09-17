import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getE2eConfig } from "@/api/e2e";
import { refiPreview } from "@/api/refi";
import type { RefiImportMode, RefiPreview } from "@/api/types";
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

const ROWS: { label: string; of: (p: RefiPreview) => number }[] = [
  { label: "text sources", of: (p) => p.textSources },
  { label: "pictures", of: (p) => p.pictureSources },
  { label: "codes", of: (p) => p.codes },
  { label: "codings", of: (p) => p.codings },
  { label: "users", of: (p) => p.users },
  { label: "notes", of: (p) => p.notes },
  { label: "variables", of: (p) => p.variables },
  { label: "sets", of: (p) => p.sets },
];

function nothingToDo(preview: RefiPreview) {
  return ROWS.every((r) => r.of(preview) === 0);
}

/**
 * Import a REFI-QDA `.qdpx` written by NVivo, ATLAS.ti, MAXQDA, QualCoder
 * and the rest.
 *
 * Three steps in one dialog: pick the file, read what is in it, choose
 * whether to merge it into this project or take it as the project. Nothing
 * is written until "Import", and the whole import is one undo.
 */
export function RefiImportDialog({ onClose }: { onClose: () => void }) {
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
      toast.info(`${report.summary}; undo with ${describe("undo")}`);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl"
        title="Import a REFI-QDA project"
        description={
          preview
            ? `${fileName}, written by ${preview.origin || "an unnamed tool"}.`
            : "Choose a .qdpx file exported by NVivo, ATLAS.ti, MAXQDA, QualCoder or another QDA tool."
        }
        data-testid="refi-import-dialog"
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {loading ? <p className="text-sm text-fg-muted">Reading {fileName}…</p> : null}

          {error ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          {preview ? (
            <>
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-2 font-medium">
                  {preview.projectName || "An unnamed REFI-QDA project"}
                </p>
                {nothingToDo(preview) ? (
                  <p className="text-fg-muted" data-testid="refi-nothing">
                    There is nothing in {fileName} that Misket can read.
                  </p>
                ) : (
                  <ul className="space-y-0.5" data-testid="refi-counts">
                    {ROWS.filter((r) => r.of(preview) > 0).map((r) => (
                      <li key={r.label} className="flex gap-2">
                        <span className="w-10 shrink-0 text-right font-medium tabular-nums">
                          {r.of(preview)}
                        </span>
                        <span>{r.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <fieldset className="space-y-2" data-testid="refi-mode">
                <legend className="mb-1 text-xs font-medium text-fg-muted">
                  How it should arrive
                </legend>
                {(
                  [
                    [
                      "merge",
                      "Merge into this project",
                      "Documents you already have are matched by their text, codes by their full name; everything else is added.",
                      true,
                    ],
                    [
                      "replace",
                      "Take it as this project",
                      preview.projectHasContent
                        ? "Only available in a project with no documents and no codes."
                        : "Everything arrives with the identities the file gives it.",
                      !preview.projectHasContent,
                    ],
                  ] as [RefiImportMode, string, string, boolean][]
                ).map(([id, title, hint, enabled]) => (
                  <label
                    key={id}
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
                  <p className="mb-1 text-xs font-medium text-fg-muted">What will not come over</p>
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
            Cancel
          </Button>
          <Button
            disabled={!preview || runImport.isPending || (preview ? nothingToDo(preview) : true)}
            onClick={() => void confirm()}
            data-testid="refi-import-confirm"
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
