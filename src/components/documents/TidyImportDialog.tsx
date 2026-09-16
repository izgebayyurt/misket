import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DEFAULT_TIDY_OPTIONS,
  previewDiffLines,
  summarizeWhitespace,
  tidyText,
  type TidyOptions,
} from "@/core/importers/tidy";
import {
  clearRememberedTidyChoice,
  saveRememberedTidyChoice,
  useTidyPromptStore,
  type TidyChoice,
  type TidyFileInfo,
} from "@/state/tidyPrompt";

/**
 * A promise-based prompt: rendered whenever `useTidyPromptStore` has a
 * pending request, and resolves it via `respond`. Mounted once near the
 * app root so it works for both the picker/dropzone import path and the
 * headless e2e import path.
 */
export function TidyImportDialog() {
  const request = useTidyPromptStore((s) => s.request);
  if (!request) return null;
  return (
    <TidyImportDialogContent
      key={request.files.map((f) => f.name).join("|")}
      files={request.files}
    />
  );
}

function TidyImportDialogContent({ files }: { files: TidyFileInfo[] }) {
  const [options, setOptions] = useState<TidyOptions>(DEFAULT_TIDY_OPTIONS);
  const [remember, setRemember] = useState(false);
  const respond = useTidyPromptStore((s) => s.respond);

  const preview = useMemo(() => {
    for (const f of files) {
      const after = tidyText(f.text, options);
      if (after !== f.text) return { name: f.name, diff: previewDiffLines(f.text, after) };
    }
    return null;
  }, [files, options]);

  const decide = (choice: TidyChoice) => {
    if (remember) saveRememberedTidyChoice(choice);
    respond(choice);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && decide({ apply: false })}>
      <DialogContent
        title="Tidy up whitespace before importing?"
        description="These files have blank-line gaps, trailing spaces or other whitespace that's usually accidental. Choose what to clean up, or import them exactly as they are."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <ul className="max-h-28 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
            {files.map((f) => (
              <li key={f.name}>
                <span className="font-medium">{f.name}</span>:{" "}
                {summarizeWhitespace(f.report).join(", ") || "no issues"}
              </li>
            ))}
          </ul>

          <fieldset className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={options.collapseBlankLines}
                onChange={(e) => setOptions({ ...options, collapseBlankLines: e.target.checked })}
              />
              Collapse blank-line runs
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={options.trimTrailingSpaces}
                onChange={(e) => setOptions({ ...options, trimTrailingSpaces: e.target.checked })}
              />
              Trim trailing spaces
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={options.normalizeSpaces}
                onChange={(e) => setOptions({ ...options, normalizeSpaces: e.target.checked })}
              />
              Normalize spaces &amp; tabs
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={options.unwrapHardBreaks}
                onChange={(e) => setOptions({ ...options, unwrapHardBreaks: e.target.checked })}
              />
              Unwrap hard-wrapped lines
            </label>
          </fieldset>
          {options.unwrapHardBreaks ? (
            <p className="text-xs text-fg-muted">
              Unwrapping can merge lines that were meant to stay separate (e.g. list items or short
              turns in a transcript). Check the preview below before relying on it.
            </p>
          ) : null}

          {preview ? (
            <div>
              <p className="mb-1 text-xs text-fg-muted">
                Preview of <span className="font-medium">{preview.name}</span> around line{" "}
                {preview.diff.startLine + 1}:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <DiffColumn label="Before" lines={preview.diff.before} />
                <DiffColumn label="After" lines={preview.diff.after} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-fg-muted">Nothing would change with the current options.</p>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember my choice and don&apos;t ask again
            </label>
            <button
              type="button"
              className="text-xs text-accent underline-offset-4 hover:underline"
              onClick={() => clearRememberedTidyChoice()}
            >
              Ask again on import
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => decide({ apply: false })}>
            Import as is
          </Button>
          <Button onClick={() => decide({ apply: true, options })}>Import cleaned</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffColumn({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[10px] font-medium uppercase text-fg-muted">{label}</p>
      <div className="max-h-40 overflow-auto rounded-md border border-border bg-panel p-2 font-mono text-[11px] leading-tight">
        {lines.length === 0 ? (
          <p className="text-fg-muted">(empty)</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre">
              {l === "" ? "\u00A0" : l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
