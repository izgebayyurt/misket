import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import type { ProjectInfo } from "@/api/types";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { RightPanel } from "./RightPanel";
import { DocumentPane } from "@/components/document-view/DocumentPane";
import { useWorkspace } from "@/state/workspace";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useUpdateCheckOnMount } from "@/hooks/useUpdateCheck";
import { ExcerptBrowser } from "@/components/excerpts/ExcerptBrowser";
import { AnalysisView } from "@/components/analysis/AnalysisView";
import { SearchView } from "@/components/search/SearchView";
import { DescriptorTable } from "@/components/descriptors/DescriptorTable";
import { OverviewView } from "@/components/overview/OverviewView";
import { HistoryView } from "@/components/history/HistoryView";
import { CodePalette } from "@/components/palette/CodePalette";
import { ImportDropzone } from "@/components/documents/ImportDropzone";
import { SettingsDialog } from "./SettingsDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SyncWarningBanner } from "./SyncWarningBanner";
import { UpdateBanner } from "./UpdateBanner";

export function Workspace({ project }: { project: ProjectInfo }) {
  const view = useWorkspace((s) => s.view);
  const settingsOpen = useWorkspace((s) => s.settingsOpen);
  const setSettingsOpen = useWorkspace((s) => s.setSettingsOpen);
  const shortcutsHelpOpen = useWorkspace((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useWorkspace((s) => s.setShortcutsHelpOpen);
  useGlobalShortcuts();
  useUpdateCheckOnMount();
  useEffect(() => {
    const win = getCurrentWindow();
    win.setTitle(`${project.name} — Misket`).catch(() => {});
    return () => {
      win.setTitle("Misket").catch(() => {});
    };
  }, [project.name]);
  return (
    <div className="flex h-full flex-col">
      <UpdateBanner />
      <SyncWarningBanner project={project} />
      <div className="flex min-h-0 flex-1">
        <Sidebar project={project} />
        <main className="relative flex min-w-0 flex-1 flex-col bg-bg">
          {view.kind === "document" ? (
            <DocumentPane
              key={view.documentId}
              documentId={view.documentId}
              focusExcerptId={view.focusExcerptId}
              scrollToOffset={view.scrollToOffset}
            />
          ) : view.kind === "excerpts" ? (
            // Remount when the analysis views hand over a new filter, or the
            // codebook starts a review: the browser reads both only on mount.
            <ExcerptBrowser
              key={JSON.stringify([view.initialFilter ?? null, view.review ?? null])}
            />
          ) : view.kind === "analysis" ? (
            <AnalysisView tab={view.tab} />
          ) : view.kind === "search" ? (
            // Remount when a new seed query arrives (e.g. from the
            // word-frequency view), which the view only reads on mount.
            <SearchView key={view.query ?? ""} initialQuery={view.query} />
          ) : view.kind === "descriptorTable" ? (
            <DescriptorTable />
          ) : view.kind === "overview" ? (
            <OverviewView />
          ) : view.kind === "history" ? (
            <HistoryView />
          ) : (
            <EmptyState />
          )}
          <ImportDropzone />
        </main>
        {/* The history view brings its own panel — what a step did, rather
            than memos for whatever is selected elsewhere — and two panels
            either side of the branch graph leave it nothing to draw in. */}
        {view.kind === "history" ? null : <RightPanel />}
      </div>
      <StatusBar project={project} />
      <CodePalette />
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {shortcutsHelpOpen ? <ShortcutsDialog onClose={() => setShortcutsHelpOpen(false)} /> : null}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-fg-muted">
      <p className="font-serif text-2xl text-fg">{t("workspace.emptyTitle")}</p>
      <p className="mt-2 max-w-sm text-sm">{t("workspace.emptyHint")}</p>
    </div>
  );
}
