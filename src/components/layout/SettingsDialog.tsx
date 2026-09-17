import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/codebook/ColorSwatch";
import { useSettings } from "@/state/settings";
import { useTessdataLanguages } from "@/queries/ocr";
import type { Theme } from "@/api/types";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Settings" description="Changes apply immediately.">
        <div className="space-y-5">
          <section>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Theme
            </label>
            <div className="flex gap-1" role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={settings.theme === o.value ? "default" : "outline"}
                  aria-pressed={settings.theme === o.value}
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
        </div>
      </DialogContent>
    </Dialog>
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
