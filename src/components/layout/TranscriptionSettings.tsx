import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      if (e.status === "failed") toast.error(e.message ?? t("layout.transcription.downloadFailed"));
      if (e.status === "cancelled") toast.info(t("layout.transcription.downloadPaused"));
    })
      .then(keep)
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [refetch, t]);

  async function addFile() {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t("common.fileFilters.whisperModel"), extensions: ["bin"] }],
    });
    if (typeof picked !== "string") return;
    setBusy(true);
    try {
      const id = await addWhisperModelFile(picked);
      await refetch();
      update({ whisperModel: id });
      toast.info(t("layout.transcription.addedModel", { id }));
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
        {t("layout.transcription.title")}
      </h3>
      {support && !support.available ? (
        <p className="text-xs text-fg-muted">{t("layout.transcription.noBuildSupport")}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-muted">
            <Trans
              i18nKey="layout.transcription.explanation"
              components={{
                // Trans replaces this element's children with the matching
                // span of the translated string; the fallback text here is
                // only what a screen reader (or a missing-translation
                // fallback) would ever actually see as its content.
                link: (
                  <a
                    href="https://huggingface.co/ggerganov/whisper.cpp"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    whisper.cpp
                  </a>
                ),
              }}
            />
          </p>

          <ul className="divide-y divide-border rounded border border-border">
            {isLoading ? (
              <li className="px-2 py-2 text-sm text-fg-muted">{t("common.loading")}</li>
            ) : null}
            {library?.models.map((m) => {
              const download = downloads[m.id];
              const status = download
                ? t("layout.transcription.receivedOfTotal", {
                    received: formatSize(download.received),
                    total: formatSize(download.total),
                  })
                : m.partialBytes > 0 && !m.installed
                  ? t("layout.transcription.pausedAt", { size: formatSize(m.partialBytes) })
                  : m.note;
              return (
                <li key={m.id} className="px-2 py-1.5 text-sm">
                  {/* The name, the buttons and the note are three rows' worth
                      of content in a dialog that is one column wide, so the
                      note goes underneath rather than squeezing the name to
                      nothing. */}
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{m.label}</span>
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
                        {t("layout.transcription.inUse")}
                      </span>
                    ) : null}
                    <span className="flex-1" />
                    {download ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void cancelWhisperModelDownload(m.id)}
                        aria-label={t("layout.transcription.stopDownloading", { label: m.label })}
                        data-testid={`settings-whisper-stop-${m.id}`}
                      >
                        {t("layout.transcription.stop")}
                      </Button>
                    ) : m.installed ? (
                      <>
                        <Button
                          size="sm"
                          variant={selected === m.id ? "secondary" : "outline"}
                          disabled={selected === m.id}
                          onClick={() => update({ whisperModel: m.id })}
                          aria-label={t("layout.transcription.useForTranscription", {
                            label: m.label,
                          })}
                          data-testid={`settings-whisper-use-${m.id}`}
                        >
                          {t("layout.transcription.use")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void remove(m)}
                          aria-label={t("layout.transcription.deleteModel", { label: m.label })}
                          data-testid={`settings-whisper-delete-${m.id}`}
                        >
                          {t("common.delete")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!m.known}
                        onClick={() => void downloadWhisperModel(m.id)}
                        aria-label={
                          m.partialBytes > 0
                            ? t("layout.transcription.resumeDownloading", { label: m.label })
                            : t("layout.transcription.downloadModel", { label: m.label })
                        }
                        data-testid={`settings-whisper-download-${m.id}`}
                      >
                        {m.partialBytes > 0
                          ? t("layout.transcription.resume")
                          : t("layout.transcription.download")}
                      </Button>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">{status}</p>
                  {download ? (
                    <div
                      className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={t("layout.transcription.downloadingModel", { label: m.label })}
                      aria-valuenow={download.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{ width: `${download.percent}%` }}
                      />
                    </div>
                  ) : null}
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
              aria-label={t("layout.transcription.whereModelsAreKept")}
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
              {t("layout.transcription.addModelFileEllipsis")}
            </Button>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            {t("layout.transcription.threads")}
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
              {t("layout.transcription.defaultThreadsHint", {
                count: support?.defaultThreads ?? 1,
              })}
            </span>
          </label>

          {support && !support.ffmpeg ? (
            <p className="mt-2 text-xs text-fg-muted" data-testid="settings-whisper-ffmpeg">
              <Trans i18nKey="layout.transcription.ffmpegHint" components={{ code: <code /> }} />
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
