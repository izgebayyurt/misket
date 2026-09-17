import type { AnalysisTab } from "@/state/workspace";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { CodeFrequencies } from "./CodeFrequencies";
import { CoOccurrenceMatrix } from "./CoOccurrenceMatrix";
import { CodeByDocumentMatrix } from "./CodeByDocumentMatrix";
import { FrameworkMatrixView } from "./FrameworkMatrixView";
import { CodeByDescriptorMatrix } from "./CodeByDescriptorMatrix";
import { WordFrequencies } from "./WordFrequencies";
import { CodeTreemap } from "./CodeTreemap";
import { CodeClustering } from "./CodeClustering";

const TABS: { id: AnalysisTab; label: string }[] = [
  { id: "frequencies", label: "Frequencies" },
  { id: "cooccurrence", label: "Co-occurrence" },
  { id: "matrix", label: "Code × document" },
  { id: "framework", label: "Framework" },
  { id: "descriptor", label: "By descriptor" },
  { id: "words", label: "Words" },
  { id: "treemap", label: "Treemap" },
  { id: "clustering", label: "Clustering" },
];

export function AnalysisView({ tab }: { tab: AnalysisTab }) {
  const setView = useWorkspace((s) => s.setView);
  return (
    <div className="flex h-full flex-col" data-testid="analysis-view">
      <div className="flex items-center gap-4 border-b border-border bg-panel px-4 pt-2">
        <h2 className="font-serif text-lg font-medium">Analysis</h2>
        <div className="flex gap-1 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={cn(
                "-mb-px border-b-2 border-transparent px-2 py-1 text-fg-muted hover:text-fg",
                tab === t.id && "border-accent font-medium text-fg",
              )}
              onClick={() => setView({ kind: "analysis", tab: t.id })}
              data-testid={`analysis-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "frequencies" ? (
          <CodeFrequencies />
        ) : tab === "cooccurrence" ? (
          <CoOccurrenceMatrix />
        ) : tab === "matrix" ? (
          <CodeByDocumentMatrix />
        ) : tab === "framework" ? (
          <FrameworkMatrixView />
        ) : tab === "descriptor" ? (
          <CodeByDescriptorMatrix />
        ) : tab === "treemap" ? (
          <CodeTreemap />
        ) : tab === "clustering" ? (
          <CodeClustering />
        ) : (
          <WordFrequencies />
        )}
      </div>
    </div>
  );
}
