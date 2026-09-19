import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useTranscriptionSupport, useWhisperModels } from "@/queries/transcribe";
import { useSettings } from "@/state/settings";
import { useTranscription } from "@/state/transcription";
import { startTranscription } from "@/api/transcribe";
import { PARAGRAPH_OPTIONS, modelSupportsLanguage } from "@/core/transcription";
import { toast } from "@/state/toasts";
import type { DocumentSummary } from "@/api/types";

/**
 * "Transcribe…" for one recording: which model, which language, how the
 * paragraphs come out.
 *
 * Speakers are deliberately not offered. Whisper does not do diarisation, and
 * labelling turns "Speaker 1"/"Speaker 2" from pauses in the audio would put
 * a guess into the data where a coder would read it as a fact. What the
 * dialog does offer is the layout: timestamps, and how much recording goes
 * into a paragraph.
 */
export function TranscribeDialog({ doc, onClose }: { doc: DocumentSummary; onClose: () => void }) {
  const { data: support } = useTranscriptionSupport();
  const { data: library, isLoading } = useWhisperModels();
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const startRun = useTranscription((s) => s.start);

  const installed = library?.models.filter((m) => m.installed) ?? [];
  // Not state until the person picks: the list arrives asynchronously, and a
  // remembered model that has since been deleted must fall back on its own.
  const [picked, setPicked] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>(settings.whisperLanguage ?? "auto");
  const [translate, setTranslate] = useState(settings.whisperTranslate);
  const [timestamps, setTimestamps] = useState(settings.whisperTimestamps);
  const [groupSeconds, setGroupSeconds] = useState<number | null>(
    settings.whisperGroupSeconds ?? null,
  );
  const [starting, setStarting] = useState(false);

  const preferred = picked ?? settings.whisperModel ?? library?.selected ?? null;
  const chosen = installed.find((m) => m.id === preferred) ?? installed[0] ?? null;
  const multilingual = chosen?.multilingual ?? true;
  const languageOk = modelSupportsLanguage(multilingual, language);
  const isVideo = (doc.media?.mime ?? "").startsWith("video/");
  const needsFfmpeg = isVideo && support?.ffmpeg === false;

  async function run() {
    if (!chosen) return;
    setStarting(true);
    try {
      await startTranscription({
        documentId: doc.id,
        model: chosen.id,
        language: language === "auto" ? null : language,
        translate: multilingual && translate,
        threads: settings.whisperThreads ?? null,
        layout: { timestamps, groupSeconds },
      });
      // Remember the choices; the next recording almost always wants them.
      updateSettings({
        whisperModel: chosen.id,
        whisperLanguage: language === "auto" ? null : language,
        whisperTranslate: multilingual && translate,
        whisperTimestamps: timestamps,
        whisperGroupSeconds: groupSeconds,
      });
      startRun(doc.id, doc.name);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Transcribe"
        description={doc.name}
        className="max-w-lg"
        data-testid="transcribe-dialog"
      >
        {support && !support.available ? (
          <p className="text-sm text-fg-muted" data-testid="transcribe-unavailable">
            This build of Misket was compiled without transcription support.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-fg-muted">Looking for models…</p>
        ) : installed.length === 0 ? (
          <NoModelNotice />
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Model
              </span>
              <select
                className="w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
                value={chosen?.id ?? ""}
                onChange={(e) => setPicked(e.target.value)}
                data-testid="transcribe-model"
              >
                {installed.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.sizeLabel}
                  </option>
                ))}
              </select>
              {chosen ? <p className="mt-1 text-xs text-fg-muted">{chosen.note}</p> : null}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Language
                </span>
                <select
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  data-testid="transcribe-language"
                >
                  <option value="auto">Detect automatically</option>
                  {(support?.languages ?? []).map((l) => (
                    <option
                      key={l.code}
                      value={l.code}
                      disabled={!modelSupportsLanguage(multilingual, l.code)}
                    >
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Paragraphs
                </span>
                <select
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-sm text-fg"
                  value={groupSeconds === null ? "segment" : String(groupSeconds)}
                  onChange={(e) =>
                    setGroupSeconds(e.target.value === "segment" ? null : Number(e.target.value))
                  }
                  data-testid="transcribe-paragraphs"
                >
                  {PARAGRAPH_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value === null ? "segment" : String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={timestamps}
                  onChange={(e) => setTimestamps(e.target.checked)}
                  data-testid="transcribe-timestamps"
                />
                Start every paragraph with its <code>[mm:ss]</code> timestamp
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={multilingual && translate}
                  disabled={!multilingual}
                  onChange={(e) => setTranslate(e.target.checked)}
                  data-testid="transcribe-translate"
                />
                Translate to English
                {!multilingual ? (
                  <span className="text-xs text-fg-muted">(English-only model)</span>
                ) : null}
              </label>
            </div>

            {!languageOk ? (
              <p className="text-xs text-danger" data-testid="transcribe-language-warning">
                This model only knows English. Pick a multilingual model, or set the language back
                to English.
              </p>
            ) : null}
            {needsFfmpeg ? (
              <p className="text-xs text-fg-muted" data-testid="transcribe-ffmpeg-note">
                This is a video. Misket reads the audio out of most mp4 and mkv files on its own,
                but if it cannot, it needs <code>ffmpeg</code> on your PATH — it did not find one.
              </p>
            ) : null}
            <p className="text-xs text-fg-muted">
              Everything happens on this machine. The transcript arrives as a new text document
              called “{doc.name} (transcript)”, which you can undo like any other import.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void run()}
            disabled={!chosen || !languageOk || starting || support?.available === false}
            data-testid="transcribe-start"
          >
            {starting ? "Starting…" : "Transcribe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What to do when nothing has been downloaded yet — the default state. */
function NoModelNotice() {
  return (
    <div className="space-y-2 text-sm" data-testid="transcribe-no-model">
      <p>Misket has no transcription model yet.</p>
      <p className="text-fg-muted">
        Transcription runs entirely on this machine, so it needs a Whisper model file on disk. Open{" "}
        <strong>Settings → Transcription</strong> and download one — <em>Tiny</em> is 75 MiB and
        enough to see whether this works for your audio; <em>Small</em> is the usual choice for
        interviews. On a machine with no network, copy a <code>ggml-*.bin</code> across and use “Add
        model file…”.
      </p>
    </div>
  );
}
