import { useState } from "react";
import { describe } from "@/core/keymap";
import type { ProjectInfo } from "@/api/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/state/workspace";
import { DocumentList } from "@/components/documents/DocumentList";
import { CodeTree } from "@/components/codebook/CodeTree";
import { Button } from "@/components/ui/button";
import { DescriptorsDialog } from "@/components/descriptors/DescriptorsDialog";
import { BarChart3, List, Search, Settings2, Tags } from "lucide-react";

export function Sidebar({ project }: { project: ProjectInfo }) {
  const tab = useWorkspace((s) => s.sidebarTab);
  const setTab = useWorkspace((s) => s.setSidebarTab);
  const view = useWorkspace((s) => s.view);
  const setView = useWorkspace((s) => s.setView);
  const [descriptors, setDescriptors] = useState(false);
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel">
      <div className="border-b border-border px-3 py-2">
        <div className="truncate font-serif text-base font-medium" title={project.path}>
          {project.name}
        </div>
      </div>
      <div className="flex border-b border-border text-sm">
        {(["documents", "codes"] as const).map((t) => (
          <button
            key={t}
            className={cn(
              "flex-1 py-1.5 capitalize text-fg-muted hover:text-fg",
              tab === t && "border-b-2 border-accent font-medium text-fg",
            )}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "documents" ? <DocumentList /> : <CodeTree />}
      </div>
      <div className="space-y-1 border-t border-border p-2">
        {tab === "documents" ? (
          <div className="flex gap-1">
            <Button
              variant={view.kind === "descriptorTable" ? "secondary" : "ghost"}
              className="min-w-0 flex-1 justify-start"
              onClick={() => setView({ kind: "descriptorTable" })}
              data-testid="open-descriptor-table"
            >
              <Tags /> Descriptors
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDescriptors(true)}
              title="Manage descriptors"
              aria-label="Manage descriptors"
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
          <List /> Excerpts
          <span className="ml-auto text-xs text-fg-muted">{describe("excerptBrowser")}</span>
        </Button>
        <Button
          variant={view.kind === "analysis" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "analysis", tab: "frequencies" })}
          data-testid="open-analysis"
        >
          <BarChart3 /> Analysis
          <span className="ml-auto text-xs text-fg-muted">{describe("analysis")}</span>
        </Button>
        <Button
          variant={view.kind === "search" ? "secondary" : "ghost"}
          className="w-full justify-start"
          onClick={() => setView({ kind: "search" })}
          data-testid="open-search"
        >
          <Search /> Search
          <span className="ml-auto text-xs text-fg-muted">{describe("findInProject")}</span>
        </Button>
      </div>
      {descriptors ? <DescriptorsDialog onClose={() => setDescriptors(false)} /> : null}
    </aside>
  );
}
