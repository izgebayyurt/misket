import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ProjectInfo } from "@/api/types";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { RightPanel } from "./RightPanel";
import { DocumentPane } from "@/components/document-view/DocumentPane";
import { useWorkspace } from "@/state/workspace";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { ExcerptBrowser } from "@/components/excerpts/ExcerptBrowser";
import { AnalysisView } from "@/components/analysis/AnalysisView";
import { SearchView } from "@/components/search/SearchView";
import { DescriptorTable } from "@/components/descriptors/DescriptorTable";
import { OverviewView } from "@/components/overview/OverviewView";
import { CodePalette } from "@/components/palette/CodePalette";
import { ImportDropzone } from "@/components/documents/ImportDropzone";
import { SettingsDialog } from "./SettingsDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function Workspace({ project }: { project: ProjectInfo }) {
  const view = useWorkspace((s) => s.view);
  const settingsOpen = useWorkspace((s) => s.settingsOpen);
  const setSettingsOpen = useWorkspace((s) => s.setSettingsOpen);
  const shortcutsHelpOpen = useWorkspace((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useWorkspace((s) => s.setShortcutsHelpOpen);
  useGlobalShortcuts();
  useEffect(() => {
    const win = getCurrentWindow();
    win.setTitle(`${project.name} — Misket`).catch(() => {});
    return () => {
      win.setTitle("Misket").catch(() => {});
    };
  }, [project.name]);
  return (
    <div className="flex h-full flex-col">
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
            // Remount when the analysis views hand over a new filter, which
            // the browser only reads on mount.
            <ExcerptBrowser key={JSON.stringify(view.initialFilter ?? null)} />
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
          ) : (
            <EmptyState />
          )}
          <ImportDropzone />
        </main>
        <RightPanel />
      </div>
      <StatusBar project={project} />
      <CodePalette />
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {shortcutsHelpOpen ? <ShortcutsDialog onClose={() => setShortcutsHelpOpen(false)} /> : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-fg-muted">
      <p className="font-serif text-2xl text-fg">Nothing open yet</p>
      <p className="mt-2 max-w-sm text-sm">
        Import a transcript, notes or an image from the sidebar, or drop text, Markdown, Word, PDF
        or image files anywhere in this window.
      </p>
    </div>
  );
}
