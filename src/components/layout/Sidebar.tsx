import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describe } from "@/core/keymap";
import type { ProjectInfo } from "@/api/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/state/workspace";
import { DocumentList } from "@/components/documents/DocumentList";
import { CodeTree } from "@/components/codebook/CodeTree";
import { Button } from "@/components/ui/button";
import { DescriptorsDialog } from "@/components/descriptors/DescriptorsDialog";
import { BarChart3, History, Home, List, Search, Settings2, Tags } from "lucide-react";

export function Sidebar({ project }: { project: ProjectInfo }) {
  const { t } = useTranslation();
  const tab = useWorkspace((s) => s.sidebarTab);
  const setTab = useWorkspace((s) => s.setSidebarTab);
  const view = useWorkspace((s) => s.view);
  const setView = useWorkspace((s) => s.setView);
  const [descriptors, setDescriptors] = useState(false);
  const TAB_LABELS = { documents: t("sidebar.documents"), codes: t("sidebar.codes") } as const;
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel">
      <div className="border-b border-border px-3 py-2">
        <div className="truncate font-serif text-base font-medium" title={project.path}>
          {project.name}
        </div>
      </div>
      <div className="flex border-b border-border text-sm">
        {(["documents", "codes"] as const).map((tabId) => (
          <button
            key={tabId}
            className={cn(
              "flex-1 py-1.5 text-fg-muted hover:text-fg",
              tab === tabId && "border-b-2 border-accent font-medium text-fg",
            )}
            onClick={() => setTab(tabId)}
            data-testid={`tab-${tabId}`}
          >
            {TAB_LABELS[tabId]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "documents" ? <DocumentList /> : <CodeTree />}
      </div>
      <div className="space-y-1 border-t border-border p-2">
        <Button
          variant={view.kind === "overview" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "overview" })}
          data-testid="open-overview"
        >
          <Home /> {t("sidebar.overview")}
          <span className="ml-auto text-xs text-fg-muted">{describe("overview")}</span>
        </Button>
        <Button
          variant={view.kind === "history" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "history" })}
          data-testid="open-history"
        >
          <History /> {t("history.title")}
          <span className="ml-auto text-xs text-fg-muted">{describe("history")}</span>
        </Button>
        {tab === "documents" ? (
          <div className="flex gap-1">
            <Button
              variant={view.kind === "descriptorTable" ? "secondary" : "ghost"}
              className="min-w-0 flex-1 justify-start"
              onClick={() => setView({ kind: "descriptorTable" })}
              data-testid="open-descriptor-table"
            >
              <Tags /> {t("sidebar.descriptors")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDescriptors(true)}
              title={t("sidebar.manageDescriptors")}
              aria-label={t("sidebar.manageDescriptors")}
              data-testid="open-descriptors"
            >
              <Settings2 />
            </Button>
          </div>
        ) : null}
        <Button
          variant={view.kind === "excerpts" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "excerpts" })}
          data-testid="open-excerpts"
        >
          <List /> {t("sidebar.excerpts")}
          <span className="ml-auto text-xs text-fg-muted">{describe("excerptBrowser")}</span>
        </Button>
        <Button
          variant={view.kind === "analysis" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "analysis", tab: "frequencies" })}
          data-testid="open-analysis"
        >
          <BarChart3 /> {t("sidebar.analysis")}
          <span className="ml-auto text-xs text-fg-muted">{describe("analysis")}</span>
        </Button>
        <Button
          variant={view.kind === "search" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "search" })}
          data-testid="open-search"
        >
          <Search /> {t("sidebar.search")}
          <span className="ml-auto text-xs text-fg-muted">{describe("findInProject")}</span>
        </Button>
      </div>
      {descriptors ? <DescriptorsDialog onClose={() => setDescriptors(false)} /> : null}
    </aside>
  );
}
