import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        {t("statusBar.counts", {
          documents: project.counts.documents,
          codes: project.counts.codes,
          excerpts: project.counts.excerpts,
        })}
      </span>
      {lastLabel ? (
        <span className="truncate">{t("statusBar.last", { label: lastLabel })}</span>
      ) : null}
      {quickCode ? (
        <span
          className="truncate"
          title={t("statusBar.quickCodeHint", { chord: describe("quickCode"), name: quickCode.name })}
          data-testid="quick-code-hint"
        >
          {t("statusBar.quickCode", { name: quickCode.name })}
        </span>
      ) : null}
      <span className="flex-1" />
      <ExportMenu project={project} />
      <button
        className="hover:text-fg"
        aria-label={t("keymap.shortcutsHelp")}
        title={t("keymap.shortcutsHelp")}
        onClick={() => setShortcutsHelpOpen(true)}
      >
        ?
      </button>
      <button
        className="hover:text-fg"
        onClick={() => setRefi(true)}
        title={t("statusBar.refiHint")}
        data-testid="open-refi-import"
      >
        {t("statusBar.refi")}
      </button>
      <button
        className="hover:text-fg"
        onClick={() => setPull(true)}
        title={t("statusBar.pullHint")}
        data-testid="open-pull"
      >
        {t("statusBar.pull")}
      </button>
      <button className="hover:text-fg" onClick={() => setBackups(true)}>
        {t("statusBar.backups")}
      </button>
      <button className="hover:text-fg" onClick={() => setSettingsOpen(true)}>
        {t("settings.title")}
      </button>
      <button className="hover:text-fg" onClick={() => setAbout(true)}>
        {t("statusBar.about")}
      </button>
      <button className="hover:text-fg" onClick={() => close.mutate()}>
        {t("statusBar.closeProject")}
      </button>
      {about ? <AboutDialog onClose={() => setAbout(false)} /> : null}
      {backups ? <BackupsDialog onClose={() => setBackups(false)} /> : null}
      {pull ? <PullDialog onClose={() => setPull(false)} /> : null}
      {refi ? <RefiImportDialog onClose={() => setRefi(false)} /> : null}
    </footer>
  );
}
