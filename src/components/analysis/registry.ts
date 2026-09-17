import type { ComponentType } from "react";
import {
  BarChart3,
  Grid2x2,
  LayoutGrid,
  Network,
  Scale,
  Table,
  Table2,
  Tags,
  Type,
  Weight,
} from "lucide-react";
import type { AnalysisTab } from "@/state/workspace";
import { CodeFrequencies } from "./CodeFrequencies";
import { CoOccurrenceMatrix } from "./CoOccurrenceMatrix";
import { CodeByDocumentMatrix } from "./CodeByDocumentMatrix";
import { FrameworkMatrixView } from "./FrameworkMatrixView";
import { CodeByDescriptorMatrix } from "./CodeByDescriptorMatrix";
import { WordFrequencies } from "./WordFrequencies";
import { CodeTreemap } from "./CodeTreemap";
import { CodeClustering } from "./CodeClustering";
import { WeightsView } from "./WeightsView";
import { ReliabilityView } from "./ReliabilityView";

/**
 * Every analysis the Analysis view offers, in the order the list shows them.
 *
 * This is the single place an analysis is registered: the left-hand list, the
 * body, and the `{ kind: "analysis", tab }` view state all read it. Adding an
 * analysis means adding one entry here and nothing else — which is the point,
 * since the row of tabs this replaced could not grow any further.
 */

/** The small headings the list groups entries under. */
export type AnalysisGroup = "codes" | "across" | "text" | "team" | "mixed";

export interface AnalysisEntry {
  id: AnalysisTab;
  label: string;
  group: AnalysisGroup;
  /** A lucide icon; the only thing shown when the list is collapsed. */
  icon: ComponentType<{ className?: string }>;
  component: ComponentType;
  /**
   * A key that jumps straight to this analysis, if it has one, as
   * `core/keymap`'s `describe` would render it. Shown at the end of the row.
   */
  shortcut?: string;
}

/** Group order and headings. A group with no entries is not drawn. */
export const ANALYSIS_GROUPS: { id: AnalysisGroup; label: string }[] = [
  { id: "codes", label: "Codes" },
  { id: "across", label: "Across data" },
  { id: "text", label: "Text" },
  { id: "team", label: "Team" },
  { id: "mixed", label: "Mixed" },
];

export const ANALYSES: AnalysisEntry[] = [
  {
    id: "frequencies",
    label: "Frequencies",
    group: "codes",
    icon: BarChart3,
    component: CodeFrequencies,
  },
  {
    id: "cooccurrence",
    label: "Co-occurrence",
    group: "codes",
    icon: Grid2x2,
    component: CoOccurrenceMatrix,
  },
  { id: "treemap", label: "Treemap", group: "codes", icon: LayoutGrid, component: CodeTreemap },
  {
    id: "clustering",
    label: "Clustering",
    group: "codes",
    icon: Network,
    component: CodeClustering,
  },
  // Another codebook-shape analysis goes here, after Clustering, as one
  // entry of exactly this shape — plus its id in `AnalysisTab`
  // (`src/state/workspace.ts`) and nothing else:
  //   { id: "overlap", label: "Overlap", group: "codes", icon: Layers, component: CodeOverlap },
  {
    id: "matrix",
    label: "By document",
    group: "across",
    icon: Table,
    component: CodeByDocumentMatrix,
  },
  {
    id: "descriptor",
    label: "By descriptor",
    group: "across",
    icon: Tags,
    component: CodeByDescriptorMatrix,
  },
  {
    id: "framework",
    label: "Framework",
    group: "across",
    icon: Table2,
    component: FrameworkMatrixView,
  },
  { id: "words", label: "Words", group: "text", icon: Type, component: WordFrequencies },
  {
    id: "reliability",
    label: "Reliability",
    group: "team",
    icon: Scale,
    component: ReliabilityView,
  },
  { id: "weights", label: "Weights", group: "mixed", icon: Weight, component: WeightsView },
  // Another analysis that crosses the qualitative and the countable goes
  // here, in the "mixed" group — one entry, plus its id in `AnalysisTab`
  // (`src/state/workspace.ts`) and nothing else.
];

/**
 * The entry for a tab, falling back to the first analysis. The fallback
 * matters: a `{ kind: "analysis", tab }` view can name an analysis that this
 * build does not have (an older window's state, a branch without it yet).
 */
export function analysisEntry(tab: AnalysisTab): AnalysisEntry {
  return ANALYSES.find((a) => a.id === tab) ?? ANALYSES[0]!;
}
