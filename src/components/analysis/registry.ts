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
  /** A translation key, not the label itself — this module is data, plain
   * and framework-free; the nav resolves it with `t()` when it renders. */
  labelKey: string;
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

/** Group order and headings (translation keys). A group with no entries is
 * not drawn. */
export const ANALYSIS_GROUPS: { id: AnalysisGroup; labelKey: string }[] = [
  { id: "codes", labelKey: "analysis.groups.codes" },
  { id: "across", labelKey: "analysis.groups.across" },
  { id: "text", labelKey: "analysis.groups.text" },
  { id: "team", labelKey: "analysis.groups.team" },
  { id: "mixed", labelKey: "analysis.groups.mixed" },
];

export const ANALYSES: AnalysisEntry[] = [
  {
    id: "frequencies",
    labelKey: "analysis.tabs.frequencies",
    group: "codes",
    icon: BarChart3,
    component: CodeFrequencies,
  },
  {
    id: "cooccurrence",
    labelKey: "analysis.tabs.cooccurrence",
    group: "codes",
    icon: Grid2x2,
    component: CoOccurrenceMatrix,
  },
  {
    id: "treemap",
    labelKey: "analysis.tabs.treemap",
    group: "codes",
    icon: LayoutGrid,
    component: CodeTreemap,
  },
  {
    id: "clustering",
    labelKey: "analysis.tabs.clustering",
    group: "codes",
    icon: Network,
    component: CodeClustering,
  },
  // Another codebook-shape analysis goes here, after Clustering, as one
  // entry of exactly this shape — plus its id in `AnalysisTab`
  // (`src/state/workspace.ts`) and nothing else:
  //   { id: "overlap", labelKey: "analysis.tabs.overlap", group: "codes", icon: Layers, component: CodeOverlap },
  {
    id: "matrix",
    labelKey: "analysis.tabs.matrix",
    group: "across",
    icon: Table,
    component: CodeByDocumentMatrix,
  },
  {
    id: "descriptor",
    labelKey: "analysis.tabs.descriptor",
    group: "across",
    icon: Tags,
    component: CodeByDescriptorMatrix,
  },
  {
    id: "framework",
    labelKey: "analysis.tabs.framework",
    group: "across",
    icon: Table2,
    component: FrameworkMatrixView,
  },
  {
    id: "words",
    labelKey: "analysis.tabs.words",
    group: "text",
    icon: Type,
    component: WordFrequencies,
  },
  {
    id: "reliability",
    labelKey: "analysis.tabs.reliability",
    group: "team",
    icon: Scale,
    component: ReliabilityView,
  },
  {
    id: "weights",
    labelKey: "analysis.tabs.weights",
    group: "mixed",
    icon: Weight,
    component: WeightsView,
  },
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
