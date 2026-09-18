import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addWhisperModelFile,
  cancelWhisperModelDownload,
  deleteWhisperModel,
  downloadWhisperModel,
  onModelDownloadDone,
  onModelDownloadProgress,
} from "@/api/transcribe";
import { formatSize } from "@/core/transcription";
import { useTranscriptionSupport, useWhisperModels } from "@/queries/transcribe";
import { useSettings } from "@/state/settings";
import { toast } from "@/state/toasts";
import type { WhisperModel } from "@/api/transcribe";

interface DownloadState {
  received: number;
  total: number;
  percent: number;
}

/**
 * Settings → Transcription: the Whisper models on this machine.
 *
 * Nothing is bundled and nothing is downloaded until someone presses
 * Download, which is the whole point — transcription is offline, and the one
 * network call in the feature is this one. A machine with no network at all
 * can take a `ggml-*.bin` copied across on a stick instead.
 */
export function TranscriptionSettings() {
  const { data: support } = useTranscriptionSupport();
  const { data: library, isLoading, refetch } = useWhisperModels();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    const keep = (fn: () => void) => (cancelled ? fn() : unlisteners.push(fn));

    void onModelDownloadProgress((e) => {
      setDownloads((d) => ({
        ...d,
        [e.id]: { received: e.received, total: e.total, percent: e.percent },
      }));
    })
      .then(keep)
      .catch(() => {});

    void onModelDownloadDone((e) => {
      setDownloads((d) => {
        const next = { ...d };
        delete next[e.id];
        return next;
      });
      void refetch();
      if (e.status === "failed") toast.error(e.message ?? "The download failed.");
      if (e.status === "cancelled") toast.info("Download paused. Press Download to resume.");
    })
      .then(keep)
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [refetch]);

  async function addFile() {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Whisper model", extensions: ["bin"] }],
    });
    if (typeof picked !== "string") return;
    setBusy(true);
    try {
      const id = await addWhisperModelFile(picked);
      await refetch();
      update({ whisperModel: id });
      toast.info(`Added ${id}.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(model: WhisperModel) {
    setBusy(true);
    try {
      await deleteWhisperModel(model.id);
      if (settings.whisperModel === model.id) update({ whisperModel: null });
      await refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const selected = settings.whisperModel ?? library?.selected ?? null;

  return (
    <section data-testid="settings-transcription">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Transcription
      </h3>
      {support && !support.available ? (
        <p className="text-xs text-fg-muted">
          This build of Misket was compiled without transcription support.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-muted">
            Audio and video are transcribed on this machine with Whisper. Nothing is sent anywhere;
            the model file is downloaded once, from the{" "}
            <a
              href="https://huggingface.co/ggerganov/whisper.cpp"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              whisper.cpp
            </a>{" "}
            model repository, and checked against its published checksum.
          </p>

          <ul className="divide-y divide-border rounded border border-border">
            {isLoading ? <li className="px-2 py-2 text-sm text-fg-muted">Loading…</li> : null}
            {library?.models.map((m) => {
              const download = downloads[m.id];
              return (
                <li key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{m.label}</span>
                      <span className="shrink-0 text-xs text-fg-muted">{m.sizeLabel}</span>
                      {!m.multilingual ? (
                        <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-fg-muted">
                          en
                        </span>
                      ) : null}
                      {selected === m.id ? (
                        <span
                          className="shrink-0 rounded bg-accent/15 px-1 text-[10px] uppercase text-accent"
                          data-testid={`settings-whisper-in-use-${m.id}`}
                        >
                          in use
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {download
                        ? `${formatSize(download.received)} of ${formatSize(download.total)}`
                        : m.partialBytes > 0 && !m.installed
                          ? `Paused at ${formatSize(m.partialBytes)} — Download resumes it`
                          : m.note}
                    </span>
                    {download ? (
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-accent transition-[width]"
                          style={{ width: `${download.percent}%` }}
                        />
                      </span>
                    ) : null}
                  </span>
                  {download ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void cancelWhisperModelDownload(m.id)}
                      data-testid={`settings-whisper-stop-${m.id}`}
                    >
                      Stop
                    </Button>
                  ) : m.installed ? (
                    <>
                      <Button
                        size="sm"
                        variant={selected === m.id ? "secondary" : "outline"}
                        disabled={selected === m.id}
                        onClick={() => update({ whisperModel: m.id })}
                        data-testid={`settings-whisper-use-${m.id}`}
                      >
                        Use
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void remove(m)}
                        data-testid={`settings-whisper-delete-${m.id}`}
                      >
                        Delete
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!m.known}
                      onClick={() => void downloadWhisperModel(m.id)}
                      data-testid={`settings-whisper-download-${m.id}`}
                    >
                      {m.partialBytes > 0 ? "Resume" : "Download"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex items-center gap-2">
            <Input
              readOnly
              value={library?.dir ?? ""}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Where models are kept"
              data-testid="settings-whisper-dir"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void addFile()}
              data-testid="settings-whisper-add-file"
            >
              Add model file…
            </Button>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            Threads
            <input
              type="number"
              min={1}
              max={64}
              className="w-20 rounded border border-border bg-bg px-2 py-0.5 text-sm text-fg"
              value={settings.whisperThreads ?? support?.defaultThreads ?? 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                update({ whisperThreads: Number.isFinite(n) && n > 0 ? n : null });
              }}
              data-testid="settings-whisper-threads"
            />
            <span className="text-xs text-fg-muted">
              default {support?.defaultThreads ?? 1} (one fewer than this machine has)
            </span>
          </label>

          {support && !support.ffmpeg ? (
            <p className="mt-2 text-xs text-fg-muted" data-testid="settings-whisper-ffmpeg">
              Audio files need nothing else. Misket reads the sound out of most mp4 and mkv video on
              its own, but for the rest it falls back to <code>ffmpeg</code>, which it could not
              find on your PATH.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
