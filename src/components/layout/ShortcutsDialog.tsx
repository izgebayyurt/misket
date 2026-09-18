import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  describe,
  describeMedia,
  label,
  mediaLabel,
  MEDIA_SHORTCUTS,
  type Action,
  type MediaAction,
} from "@/core/keymap";
import { useCodes } from "@/queries/codes";
import { ColorDot } from "@/components/codebook/ColorSwatch";

const GROUPS: { title: string; actions: Action[] }[] = [
  {
    title: "Navigation",
    actions: [
      "overview",
      "history",
      "find",
      "findInProject",
      "excerptBrowser",
      "analysis",
      "tabDocuments",
      "tabCodes",
      "nextExcerpt",
      "prevExcerpt",
      "jumpTop",
      "jumpBottom",
      "goToParagraph",
      "alignHere",
      "escape",
    ],
  },
  {
    title: "Coding",
    actions: [
      "palette",
      "inVivoCode",
      "quickCode",
      "editExcerpt",
      "deleteExcerpt",
      "extendSelectionLeft",
      "extendSelectionRight",
    ],
  },
  {
    title: "Excerpt boundaries",
    actions: [
      "excerptEndLeft",
      "excerptEndRight",
      "excerptEndLeftChar",
      "excerptEndRightChar",
      "excerptStartLeft",
      "excerptStartRight",
      "excerptStartLeftChar",
      "excerptStartRightChar",
      "splitExcerpt",
      "mergeExcerpt",
    ],
  },
  {
    title: "Project",
    actions: ["openProject", "newProject", "import", "newMemo", "settings", "shortcutsHelp"],
  },
  {
    title: "Editing",
    actions: ["undo", "redo"],
  },
];

/** The player's bare keys, live only while the audio/video view has focus. */
const MEDIA_GROUP = Object.keys(MEDIA_SHORTCUTS) as MediaAction[];

/**
 * Keys the history view handles itself while its list has focus, rather than
 * through the keymap — there is nothing global about them.
 */
const HISTORY_KEYS: [string, string][] = [
  ["Move the selection", "↑ ↓"],
  ["Fold or unfold a day", "Enter"],
  ["Go to the selected step", "G"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { data: codes } = useCodes();
  const withShortcut = (codes ?? []).filter((c) => c.shortcut);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Keyboard shortcuts" className="max-w-lg">
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {g.title}
              </h3>
              <dl className="space-y-1">
                {g.actions.map((action) => (
                  <div key={action} className="flex items-center justify-between gap-4 text-sm">
                    <dt>{label(action)}</dt>
                    <dd className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {describe(action)}
                    </dd>
                  </div>
                ))}
              </dl>
              {g.title === "Coding" ? (
                <dl className="space-y-1">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <dt>Rate the last applied code, with an excerpt focused</dt>
                    <dd className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      1–9
                    </dd>
                  </div>
                </dl>
              ) : null}
            </section>
          ))}
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Audio and video
            </h3>
            <p className="mb-1.5 text-xs text-fg-muted">
              Bare keys, live only while the player has the focus. With an in- and out-point marked,{" "}
              {describe("editExcerpt")} or {describe("palette")} codes that stretch.
            </p>
            <dl className="space-y-1">
              {MEDIA_GROUP.map((action) => (
                <div key={action} className="flex items-center justify-between gap-4 text-sm">
                  <dt>{mediaLabel(action)}</dt>
                  <dd className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {describeMedia(action)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              In the History view
            </h3>
            <dl className="space-y-1">
              {HISTORY_KEYS.map(([what, key]) => (
                <div key={what} className="flex items-center justify-between gap-4 text-sm">
                  <dt>{what}</dt>
                  <dd className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {key}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Code hotkeys
            </h3>
            {withShortcut.length === 0 ? (
              <p className="text-sm text-fg-muted">No codes have a hotkey yet.</p>
            ) : (
              <dl className="space-y-1">
                {withShortcut.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="flex min-w-0 items-center gap-2">
                      <ColorDot color={c.color} />
                      <span className="truncate">{c.name}</span>
                    </dt>
                    <dd className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs uppercase">
                      {c.shortcut}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
