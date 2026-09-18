import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/codebook/ColorSwatch";
import { useSettings } from "@/state/settings";
import { useUpdates } from "@/state/updates";
import { useTessdataLanguages } from "@/queries/ocr";
import { sendReportNow } from "@/api/diagnostics";
import { toast } from "@/state/toasts";
import { LogViewerDialog } from "./LogViewerDialog";
import type { Language, ReportFormat, Theme } from "@/api/types";

const THEME_OPTIONS: { value: Theme; labelKey: string }[] = [
  { value: "system", labelKey: "settings.theme.system" },
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
];

const LANGUAGE_OPTIONS: { value: Language; labelKey: string }[] = [
  { value: "system", labelKey: "settings.language.system" },
  { value: "en", labelKey: "settings.language.en" },
  { value: "tr", labelKey: "settings.language.tr" },
];

const REPORT_FORMAT_OPTIONS: { value: ReportFormat; labelKey: string }[] = [
  { value: "json", labelKey: "settings.diagnostics.formatJson" },
  { value: "sentry", labelKey: "settings.diagnostics.formatSentry" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("settings.title")} description={t("settings.description")}>
        <div className="space-y-5">
          <section>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {t("settings.theme.label")}
            </label>
            <div className="flex gap-1" role="radiogroup" aria-label={t("settings.theme.label")}>
              {THEME_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={settings.theme === o.value ? "default" : "outline"}
                  aria-pressed={settings.theme === o.value}
                  onClick={() => update({ theme: o.value })}
                >
                  {t(o.labelKey)}
                </Button>
              ))}
            </div>
          </section>

          <section>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {t("settings.language.label")}
            </label>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-label={t("settings.language.label")}
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={settings.language === o.value ? "default" : "outline"}
                  aria-pressed={settings.language === o.value}
                  onClick={() => update({ language: o.value })}
                  data-testid={`settings-language-${o.value}`}
                >
                  {t(o.labelKey)}
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
                {t("settings.documentTextSize")}
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
                {t("settings.lineSpacing")}
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
              {t("settings.showParagraphNumbers")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.showSpeakerGutter}
                onChange={(e) => update({ showSpeakerGutter: e.target.checked })}
                data-testid="settings-speaker-gutter"
              />
              {t("settings.showSpeakerGutter")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.confirmDeleteExcerpt}
                onChange={(e) => update({ confirmDeleteExcerpt: e.target.checked })}
              />
              {t("settings.confirmDeleteExcerpt")}
            </label>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="settings-keep-backups"
                className="text-xs font-semibold uppercase tracking-wide text-fg-muted"
              >
                {t("settings.backupsToKeep")}
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

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {t("settings.you.title")}
            </h3>
            <label htmlFor="settings-coder-name" className="mb-1 block text-sm">
              {t("settings.you.name")}
            </label>
            <Input
              id="settings-coder-name"
              value={settings.coderName ?? ""}
              placeholder={t("settings.you.namePlaceholder")}
              onChange={(e) => update({ coderName: e.target.value })}
              data-testid="settings-coder-name"
            />
            <p className="mt-1 text-xs text-fg-muted">{t("settings.you.nameHint")}</p>

            <div className="mt-3">
              <span className="mb-1 block text-sm">{t("settings.you.colour")}</span>
              <ColorPicker
                value={settings.coderColor ?? ""}
                onChange={(coderColor) => update({ coderColor })}
              />
              <p className="mt-1 text-xs text-fg-muted">{t("settings.you.colourHint")}</p>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.lanesByCoder}
                onChange={(e) => update({ lanesByCoder: e.target.checked })}
                data-testid="settings-lanes-by-coder"
              />
              {t("settings.you.lanesByCoder")}
            </label>

            <div className="mt-3">
              <span className="mb-1 block text-sm">{t("settings.you.coderId")}</span>
              <Input
                readOnly
                value={settings.coderId ?? t("settings.you.coderIdNotSet")}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
                data-testid="settings-coder-id"
              />
              <p className="mt-1 text-xs text-fg-muted">{t("settings.you.coderIdHint")}</p>
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
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const status = useUpdates((s) => s.status);
  const checkNow = useUpdates((s) => s.checkNow);

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("settings.updates.title")}
      </h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.checkForUpdatesAutomatically}
          onChange={(e) => update({ checkForUpdatesAutomatically: e.target.checked })}
          data-testid="settings-auto-update"
        />
        {t("settings.updates.autoCheck")}
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
          {status === "checking" ? t("settings.updates.checking") : t("settings.updates.checkNow")}
        </Button>
        {settings.skippedUpdateVersion ? (
          <span className="text-xs text-fg-muted">
            {t("settings.updates.skipping", { version: settings.skippedUpdateVersion })}{" "}
            <button
              className="underline hover:text-fg"
              onClick={() => update({ skippedUpdateVersion: null })}
            >
              {t("settings.updates.stopSkipping")}
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
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [sending, setSending] = useState(false);

  async function sendNow() {
    setSending(true);
    try {
      await sendReportNow();
      toast.info(t("settings.diagnostics.reportSent"));
    } catch (e) {
      toast.error(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("settings.diagnostics.title")}
      </h3>

      <Button type="button" variant="outline" size="sm" onClick={onOpenLogs}>
        {t("settings.diagnostics.viewLogs")}
      </Button>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={settings.sendCrashReports}
          onChange={(e) => update({ sendCrashReports: e.target.checked })}
          data-testid="settings-send-crash-reports"
        />
        <span>
          <span className="block">{t("settings.diagnostics.sendCrashReports")}</span>
          <span className="mt-0.5 block text-xs text-fg-muted">
            {t("settings.diagnostics.sendCrashReportsHint")}
          </span>
        </span>
      </label>

      {settings.sendCrashReports ? (
        <div className="mt-3 space-y-2 pl-6">
          <div>
            <label htmlFor="settings-report-endpoint" className="mb-1 block text-sm">
              {t("settings.diagnostics.reportEndpoint")}
            </label>
            <Input
              id="settings-report-endpoint"
              value={settings.reportEndpoint}
              placeholder="https://your-collector.example/api/1/envelope/"
              onChange={(e) => update({ reportEndpoint: e.target.value })}
              data-testid="settings-report-endpoint"
            />
            <p className="mt-1 text-xs text-fg-muted">
              {t("settings.diagnostics.reportEndpointHint")}
            </p>
          </div>

          <div>
            <span className="mb-1 block text-sm">{t("settings.diagnostics.format")}</span>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-label={t("settings.diagnostics.format")}
            >
              {REPORT_FORMAT_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={settings.reportFormat === o.value ? "default" : "outline"}
                  aria-pressed={settings.reportFormat === o.value}
                  onClick={() => update({ reportFormat: o.value })}
                >
                  {t(o.labelKey)}
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
            {sending ? t("settings.diagnostics.sending") : t("settings.diagnostics.sendNow")}
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
  const { t } = useTranslation();
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
        {t("settings.ocr.title")}
      </h3>
      <p className="mb-2 text-xs text-fg-muted">
        <Trans
          i18nKey="settings.ocr.intro"
          components={{
            code: <code />,
            ext: <code />,
            link: (
              <a
                href="https://github.com/tesseract-ocr/tessdata_fast"
                target="_blank"
                rel="noreferrer"
                className="underline"
              />
            ),
          }}
        />
      </p>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={isLoading ? t("common.loading") : (data?.dir ?? "")}
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
          {t("common.refresh")}
        </Button>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        <li className="flex items-center gap-2 text-fg-muted">
          <input type="checkbox" checked readOnly disabled />
          {t("settings.ocr.bundled")}
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
        <p className="mt-1 text-xs text-fg-muted">{t("settings.ocr.noneFound")}</p>
      ) : null}
    </section>
  );
}
