import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ProjectInfo } from "@/api/types";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { RightPanel } from "./RightPanel";
import { DocumentView } from "@/components/document-view/DocumentView";
import { useWorkspace } from "@/state/workspace";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { ExcerptBrowser } from "@/components/excerpts/ExcerptBrowser";
import { AnalysisView } from "@/components/analysis/AnalysisView";
import { CodePalette } from "@/components/palette/CodePalette";
import { ImportDropzone } from "@/components/documents/ImportDropzone";

export function Workspace({ project }: { project: ProjectInfo }) {
  const view = useWorkspace((s) => s.view);
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
            <DocumentView
              key={view.documentId}
              documentId={view.documentId}
              focusExcerptId={view.focusExcerptId}
            />
          ) : view.kind === "excerpts" ? (
            // Remount when the analysis views hand over a new filter, which
            // the browser only reads on mount.
            <ExcerptBrowser key={JSON.stringify(view.initialFilter ?? null)} />
          ) : view.kind === "analysis" ? (
            <AnalysisView tab={view.tab} />
          ) : (
            <EmptyState />
          )}
          <ImportDropzone />
        </main>
        <RightPanel />
      </div>
      <StatusBar project={project} />
      <CodePalette />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-fg-muted">
      <p className="font-serif text-2xl text-fg">Nothing open yet</p>
      <p className="mt-2 max-w-sm text-sm">
        Import a transcript or notes from the sidebar, or drop text, Markdown or Word files anywhere
        in this window.
      </p>
    </div>
  );
}
