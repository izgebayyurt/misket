import { useEffect, useMemo, useState } from "react";
import type { TranscriptFormat, TranscriptInfo, TranscriptPreset } from "@/api/types";
import { previewTranscript } from "@/api/transcripts";
import { buildOffsetMap, cpToUtf16 } from "@/core/offsets";
import { useDocument } from "@/queries/documents";
import { TRANSCRIPT_PRESETS, formatLabel } from "@/core/transcriptFormats";
import {
  useSetTranscriptDefault,
  useSetTranscriptFormat,
  useTranscript,
} from "@/queries/transcripts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/state/toasts";

type Choice = TranscriptPreset | "regex" | "none";

function choiceOf(format: TranscriptFormat | undefined): Choice {
  if (!format || format.kind === "none") return "none";
  if (format.kind === "regex") return "regex";
  return (format.preset ?? "name_colon") as TranscriptPreset;
}

function formatOf(choice: Choice, pattern: string): TranscriptFormat {
  if (choice === "none") return { kind: "none" };
  if (choice === "regex") return { kind: "regex", pattern };
  return { kind: "preset", preset: choice };
}

/**
 * How this document marks who is speaking.
 *
 * The preview is the point: every change re-reads the document through the
 * chosen format and shows the first turns it finds, so "is this the right
 * pattern?" is answered by looking rather than by guessing. Nothing is
 * written until "Use this format" — and that write is undoable, like every
 * other edit, because the backend records the previous format as its inverse.
 */
export function TranscriptFormatDialog({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const { data: current } = useTranscript(documentId);
  const { data: doc } = useDocument(documentId);
  const text = doc?.text ?? "";
  const offsetMap = useMemo(() => buildOffsetMap(text), [text]);
  const setFormat = useSetTranscriptFormat();
  const setDefault = useSetTranscriptDefault();
  const [choice, setChoice] = useState<Choice>(() => choiceOf(current?.format));
  const [pattern, setPattern] = useState(current?.format.pattern ?? "");
  const [asDefault, setAsDefault] = useState(false);

  const format = useMemo(() => formatOf(choice, pattern), [choice, pattern]);
  const key = JSON.stringify(format);

  /**
   * The last preview that came back, tagged with the format it was for, so a
   * result from a format the user has already moved on from is simply not
   * shown — no clearing, and no flash of the wrong turns.
   */
  const [result, setResult] = useState<{
    key: string;
    info: TranscriptInfo | null;
    error: string | null;
  }>(() => ({ key, info: current ?? null, error: null }));

  // Re-read the document through the chosen format. A custom pattern that
  // does not compile comes back as a validation error, which is exactly the
  // message to put under the field.
  const blank = choice === "regex" && !pattern.trim();
  useEffect(() => {
    if (blank) return;
    let cancelled = false;
    previewTranscript(documentId, format)
      .then((info) => !cancelled && setResult({ key, info, error: null }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setResult({ key, info: null, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [blank, documentId, format, key]);

  const shown = result.key === key ? result : null;
  const preview = shown?.info ?? null;
  const error = shown?.error ?? null;
  const turns = preview?.turns ?? [];
  /** The opening words of a turn, for the preview list. */
  const firstWords = (start: number, end: number) =>
    text.slice(cpToUtf16(offsetMap, start), cpToUtf16(offsetMap, Math.min(end, start + 70)));
  const canApply = choice !== "regex" || (!blank && !error && preview !== null);

  async function apply() {
    try {
      await setFormat.mutateAsync({ documentId, format });
      if (asDefault) await setDefault.mutateAsync(format);
      toast.info(`Reading this document as ${formatLabel(format)}.`);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  async function redetect() {
    try {
      await setFormat.mutateAsync({ documentId, format: null });
      toast.info("Detecting this document's transcript format again.");
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Transcript format"
        description="How this document marks who is speaking. The labels stay in the text; Misket lays them out beside it."
        className="max-w-lg"
        data-testid="transcript-dialog"
      >
        <div className="space-y-1">
          {TRANSCRIPT_PRESETS.map((p) => (
            <label
              key={p.id}
              className="flex cursor-default items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
            >
              <input
                type="radio"
                name="transcript-format"
                checked={choice === p.id}
                onChange={() => setChoice(p.id)}
                data-testid={`transcript-preset-${p.id}`}
              />
              <span className="font-medium">{p.label}</span>
              <span className="truncate text-xs text-fg-muted">{p.example}</span>
            </label>
          ))}
          <label className="flex cursor-default items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
            <input
              type="radio"
              name="transcript-format"
              checked={choice === "regex"}
              onChange={() => setChoice("regex")}
              data-testid="transcript-preset-regex"
            />
            <span className="font-medium">Custom pattern</span>
          </label>
          {choice === "regex" ? (
            <div className="pl-6">
              <Input
                autoFocus
                value={pattern}
                spellCheck={false}
                placeholder={"^<<(?<speaker>[^>]+)>>[ \\t]*"}
                onChange={(e) => setPattern(e.target.value)}
                aria-label="Custom transcript pattern"
                data-testid="transcript-pattern"
              />
              <p className="mt-1 text-xs text-fg-muted">
                A regular expression matched at the start of a line, with a named group{" "}
                <code>(?&lt;speaker&gt;…)</code> and, if the labels carry one,{" "}
                <code>(?&lt;time&gt;…)</code>.
              </p>
              {error ? (
                <p className="mt-1 text-xs text-danger" data-testid="transcript-pattern-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="flex cursor-default items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
            <input
              type="radio"
              name="transcript-format"
              checked={choice === "none"}
              onChange={() => setChoice("none")}
              data-testid="transcript-preset-none"
            />
            <span className="font-medium">Not a transcript</span>
            <span className="text-xs text-fg-muted">leave the text exactly as it is</span>
          </label>
        </div>

        <div
          className="mt-4 rounded-md border border-border bg-bg p-2"
          data-testid="transcript-preview"
        >
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
            Preview
            {preview
              ? ` — ${turns.length} turn${turns.length === 1 ? "" : "s"}, ${
                  preview.speakers.length
                } speaker${preview.speakers.length === 1 ? "" : "s"}`
              : ""}
          </p>
          {blank ? (
            <p className="py-1 text-sm text-fg-muted">Type a pattern to see what it finds.</p>
          ) : turns.length === 0 ? (
            <p className="py-1 text-sm text-fg-muted">
              {choice === "none"
                ? "The document reads as plain text, with no speaker gutter."
                : "This pattern finds no turns in this document."}
            </p>
          ) : (
            <ul className="space-y-0.5 text-sm">
              {turns.slice(0, 5).map((t) => (
                <li key={t.labelStart} className="flex gap-2 truncate">
                  <span className="shrink-0 font-medium">{t.speaker}</span>
                  {t.time ? (
                    <span className="shrink-0 text-xs text-fg-muted tabular-nums">{t.time}</span>
                  ) : null}
                  <span className="truncate text-fg-muted">{firstWords(t.start, t.end)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={asDefault}
            onChange={(e) => setAsDefault(e.target.checked)}
            data-testid="transcript-as-default"
          />
          Use as this project&rsquo;s default for new imports
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => void redetect()}>
            Detect again
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={!canApply || setFormat.isPending}>
            Use this format
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
