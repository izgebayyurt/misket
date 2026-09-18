import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/codebook/ColorSwatch";
import { AssistSettingsSection } from "@/components/assist/AssistSettingsSection";
import { useSettings } from "@/state/settings";
import { useUpdates } from "@/state/updates";
import { useTessdataLanguages } from "@/queries/ocr";
import { sendReportNow } from "@/api/diagnostics";
import { toast } from "@/state/toasts";
import { LogViewerDialog } from "./LogViewerDialog";
import type { ReportFormat, Theme } from "@/api/types";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const REPORT_FORMAT_OPTIONS: { value: ReportFormat; label: string }[] = [
  { value: "json", label: "Plain JSON" },
  { value: "sentry", label: "Sentry envelope" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Settings" description="Changes apply immediately.">
        <div className="space-y-5">
          <section>
            <div
              id="settings-theme-label"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted"
            >
              Theme
            </div>
            <div className="flex gap-1" role="radiogroup" aria-labelledby="settings-theme-label">
              {THEME_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={settings.theme === o.value ? "default" : "outline"}
                  role="radio"
                  aria-checked={settings.theme === o.value}
                  onClick={() => update({ theme: o.value })}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="settings-font-size"
                className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
              >
                Document text size
              </label>
              <span className="text-sm text-fg-muted">{settings.editorFontSize}px</span>
            </div>
            <input
              id="settings-font-size"
              type="range"
              min={13}
              max={24}
              step={1}
              value={settings.editorFontSize}
              onChange={(e) => update({ editorFontSize: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: "var(--accent)" }}
            />
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="settings-line-height"
                className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
              >
                Line spacing
              </label>
              <span className="text-sm text-fg-muted">{settings.editorLineHeight.toFixed(1)}</span>
            </div>
            <input
              id="settings-line-height"
              type="range"
              min={1.3}
              max={2.2}
              step={0.1}
              value={settings.editorLineHeight}
              onChange={(e) => update({ editorLineHeight: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: "var(--accent)" }}
            />
          </section>

          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.showParagraphNumbers}
                onChange={(e) => update({ showParagraphNumbers: e.target.checked })}
                data-testid="settings-paragraph-numbers"
              />
              Show paragraph numbers in documents
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.showSpeakerGutter}
                onChange={(e) => update({ showSpeakerGutter: e.target.checked })}
                data-testid="settings-speaker-gutter"
              />
              Show transcript speakers in a gutter
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.confirmDeleteExcerpt}
                onChange={(e) => update({ confirmDeleteExcerpt: e.target.checked })}
              />
              Confirm before deleting an excerpt
            </label>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="settings-keep-backups"
                className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
              >
                Backups to keep
              </label>
              <span className="text-sm text-fg-muted">{settings.keepBackups}</span>
            </div>
            <input
              id="settings-keep-backups"
              type="range"
              min={1}
              max={100}
              step={1}
              value={settings.keepBackups}
              onChange={(e) => update({ keepBackups: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: "var(--accent)" }}
            />
          </section>

          <OcrLanguagesSection />

          <AssistSettingsSection />

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              You
            </h3>
            <label htmlFor="settings-coder-name" className="mb-1 block text-sm">
              Name
            </label>
            <Input
              id="settings-coder-name"
              value={settings.coderName ?? ""}
              placeholder="Your computer's user name"
              onChange={(e) => update({ coderName: e.target.value })}
              data-testid="settings-coder-name"
            />
            <p className="mt-1 text-xs text-fg-muted">
              Recorded next to every change you make and on every code you apply, so a shared file
              says who did what. Leave it empty to use your computer's user name.
            </p>

            <div className="mt-3">
              <span className="mb-1 block text-sm">Colour</span>
              <ColorPicker
                value={settings.coderColor ?? ""}
                onChange={(coderColor) => update({ coderColor })}
              />
              <p className="mt-1 text-xs text-fg-muted">
                How your coding is marked when more than one person has worked on a project.
              </p>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.lanesByCoder}
                onChange={(e) => update({ lanesByCoder: e.target.checked })}
                data-testid="settings-lanes-by-coder"
              />
              Colour document underlines by coder
            </label>

            <div className="mt-3">
              <span className="mb-1 block text-sm">Coder id</span>
              <Input
                readOnly
                value={settings.coderId ?? "(not set yet)"}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="settings-coder-id"
              />
              <p className="mt-1 text-xs text-fg-muted">
                Share this with nobody; it just tells copies apart. It is generated once on this
                computer and never changes, which is how Misket can later merge a colleague&rsquo;s
                copy of a project into yours without mixing up whose coding is whose.
              </p>
            </div>
          </section>

          <DiagnosticsSection onOpenLogs={() => setLogsOpen(true)} />
          <UpdatesSection />
        </div>
      </DialogContent>
      {logsOpen ? <LogViewerDialog onClose={() => setLogsOpen(false)} /> : null}
    </Dialog>
  );
}

function UpdatesSection() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const status = useUpdates((s) => s.status);
  const checkNow = useUpdates((s) => s.checkNow);

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Updates
      </h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.checkForUpdatesAutomatically}
          onChange={(e) => update({ checkForUpdatesAutomatically: e.target.checked })}
          data-testid="settings-auto-update"
        />
        Check for updates automatically
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void checkNow({ announce: true })}
          disabled={status === "checking" || status === "downloading"}
          data-testid="check-for-updates"
        >
          {status === "checking" ? "Checking…" : "Check for updates…"}
        </Button>
        {settings.skippedUpdateVersion ? (
          <span className="text-xs text-fg-muted">
            Skipping {settings.skippedUpdateVersion}.{" "}
            <button
              className="underline hover:text-fg"
              onClick={() => update({ skippedUpdateVersion: null })}
            >
              Stop skipping
            </button>
          </span>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Off by default, and inert even when on until a maintainer's own endpoint
 * is set: see `docs/data.html` / README "Privacy and diagnostics" for the
 * exact contents of a report, and `crates/misket-core`'s sibling,
 * `src-tauri/src/reporting.rs`, for how it is built and redacted.
 */
function DiagnosticsSection({ onOpenLogs }: { onOpenLogs: () => void }) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [sending, setSending] = useState(false);

  async function sendNow() {
    setSending(true);
    try {
      await sendReportNow();
      toast.info("Report sent");
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Diagnostics
      </h3>

      <Button type="button" variant="outline" size="sm" onClick={onOpenLogs}>
        View logs…
      </Button>

      <label
        className="mt-3 flex items-start gap-2 text-sm"
        // The name lives two spans deep, past what eslint-plugin-jsx-a11y's
        // static check can see; naming it explicitly also keeps the
        // announced name to the setting, not the paragraph below it.
        aria-label="Send anonymous crash reports"
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={settings.sendCrashReports}
          onChange={(e) => update({ sendCrashReports: e.target.checked })}
          data-testid="settings-send-crash-reports"
        />
        <span>
          <span className="block">Send anonymous crash reports</span>
          <span className="mt-0.5 block text-xs text-fg-muted">
            When something breaks, sends the app version, your OS, the error message and stack, and
            the last 50 log lines (any file path in them replaced with a short hash) to the address
            below. Never sent: your document text, codes, memos or file names — and nothing at all
            unless an address is set here too.
          </span>
        </span>
      </label>

      {settings.sendCrashReports ? (
        <div className="mt-3 space-y-2 pl-6">
          <div>
            <label htmlFor="settings-report-endpoint" className="mb-1 block text-sm">
              Report endpoint
            </label>
            <Input
              id="settings-report-endpoint"
              value={settings.reportEndpoint}
              placeholder="https://your-collector.example/api/1/envelope/"
              onChange={(e) => update({ reportEndpoint: e.target.value })}
              data-testid="settings-report-endpoint"
            />
            <p className="mt-1 text-xs text-fg-muted">
              Left empty (the default), reporting stays off no matter what is checked above. A
              maintainer running their own GlitchTip- or Sentry-compatible collector puts its URL
              here.
            </p>
          </div>

          <div>
            <span className="mb-1 block text-sm">Format</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Report format">
              {REPORT_FORMAT_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={settings.reportFormat === o.value ? "default" : "outline"}
                  role="radio"
                  aria-checked={settings.reportFormat === o.value}
                  onClick={() => update({ reportFormat: o.value })}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void sendNow()}
            disabled={sending || !settings.reportEndpoint.trim()}
          >
            {sending ? "Sending…" : "Send a report now"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * PDF OCR always has the bundled `eng`; extra languages come from
 * `<code>.traineddata` files dropped into the tessdata folder (see
 * `docs/OCR.md`) — this just lists what's there and lets a person pick
 * which of them to actually use.
 */
function OcrLanguagesSection() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const { data, isLoading, refetch, isFetching } = useTessdataLanguages();

  const toggle = (lang: string, on: boolean) => {
    const next = on
      ? [...settings.ocrLanguages, lang]
      : settings.ocrLanguages.filter((l) => l !== lang);
    update({ ocrLanguages: next });
  };

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        OCR languages
      </h3>
      <p className="mb-2 text-xs text-fg-muted">
        Scanned PDFs are recognised with on-device OCR. English (<code>eng</code>) is built in; for
        another language, download its <code>.traineddata</code> file from the{" "}
        <a
          href="https://github.com/tesseract-ocr/tessdata_fast"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          tessdata_fast
        </a>{" "}
        project and drop it into this folder, then reopen Settings:
      </p>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={isLoading ? "Loading…" : (data?.dir ?? "")}
          className="font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
          data-testid="settings-tessdata-dir"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          Refresh
        </Button>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        <li className="flex items-center gap-2 text-fg-muted">
          <input type="checkbox" checked readOnly disabled />
          eng (bundled)
        </li>
        {data?.languages.map((lang) => (
          <li key={lang} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.ocrLanguages.includes(lang)}
              onChange={(e) => toggle(lang, e.target.checked)}
              data-testid={`settings-ocr-lang-${lang}`}
            />
            {lang}
          </li>
        ))}
      </ul>
      {!isLoading && data?.languages.length === 0 ? (
        <p className="mt-1 text-xs text-fg-muted">No additional languages found yet.</p>
      ) : null}
    </section>
  );
}
