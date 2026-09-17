import { useState } from "react";
import type { ProjectInfo } from "@/api/types";
import { useCloseProject } from "@/queries/project";
import { useUndoStore } from "@/state/undoStore";
import { useWorkspace } from "@/state/workspace";
import { useCodes } from "@/queries/codes";
import { describe } from "@/core/keymap";
import { ExportMenu } from "./ExportMenu";
import { AboutDialog } from "./AboutDialog";
import { BackupsDialog } from "./BackupsDialog";
import { PullDialog } from "@/components/merge/PullDialog";
import { RefiImportDialog } from "@/components/refi/RefiImportDialog";

export function StatusBar({ project }: { project: ProjectInfo }) {
  const close = useCloseProject();
  const lastLabel = useUndoStore((s) => s.lastLabel);
  const [about, setAbout] = useState(false);
  const [backups, setBackups] = useState(false);
  const [pull, setPull] = useState(false);
  const [refi, setRefi] = useState(false);
  const setSettingsOpen = useWorkspace((s) => s.setSettingsOpen);
  const setShortcutsHelpOpen = useWorkspace((s) => s.setShortcutsHelpOpen);
  const lastAppliedCodeId = useWorkspace((s) => s.lastAppliedCodeId);
  const { data: codes } = useCodes();
  const quickCode = codes?.find((c) => c.id === lastAppliedCodeId);
  return (
    <footer className="flex h-7 items-center gap-4 border-t border-border bg-panel px-3 text-xs text-fg-muted">
      <span data-testid="status-counts">
        {project.counts.documents} documents · {project.counts.codes} codes ·{" "}
        {project.counts.excerpts} excerpts
      </span>
      {lastLabel ? <span className="truncate">Last: {lastLabel}</span> : null}
      {quickCode ? (
        <span
          className="truncate"
          title={`${describe("quickCode")} applies "${quickCode.name}" to the selection or focused excerpt`}
          data-testid="quick-code-hint"
        >
          Quick code: {quickCode.name}
        </span>
      ) : null}
      <span className="flex-1" />
      <ExportMenu project={project} />
      <button
        className="hover:text-fg"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
        onClick={() => setShortcutsHelpOpen(true)}
      >
        ?
      </button>
      <button
        className="hover:text-fg"
        onClick={() => setRefi(true)}
        title="Import a REFI-QDA (.qdpx) project from NVivo, ATLAS.ti, MAXQDA or another QDA tool"
        data-testid="open-refi-import"
      >
        Import REFI-QDA…
      </button>
      <button
        className="hover:text-fg"
        onClick={() => setPull(true)}
        title="Merge another researcher's copy of this project into yours"
        data-testid="open-pull"
      >
        Pull from a copy…
      </button>
      <button className="hover:text-fg" onClick={() => setBackups(true)}>
        Backups…
      </button>
      <button className="hover:text-fg" onClick={() => setSettingsOpen(true)}>
        Settings
      </button>
      <button className="hover:text-fg" onClick={() => setAbout(true)}>
        About
      </button>
      <button className="hover:text-fg" onClick={() => close.mutate()}>
        Close project
      </button>
      {about ? <AboutDialog onClose={() => setAbout(false)} /> : null}
      {backups ? <BackupsDialog onClose={() => setBackups(false)} /> : null}
      {pull ? <PullDialog onClose={() => setPull(false)} /> : null}
      {refi ? <RefiImportDialog onClose={() => setRefi(false)} /> : null}
    </footer>
  );
}
