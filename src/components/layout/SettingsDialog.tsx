import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/state/settings";
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

          <section>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
