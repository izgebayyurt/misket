import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCodeTree } from "@/queries/codes";
import { useDocuments } from "@/queries/documents";
import { useProjectSpeakers } from "@/queries/transcripts";
import { useSets } from "@/queries/sets";
import { flattenTree, pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { FilterPicker } from "@/components/ui/filter-picker";
import { DescriptorConditions } from "@/components/descriptors/DescriptorConditions";
import { SetsPickerGroup } from "@/components/sets/SetsPickerGroup";
import { CoderFilter } from "@/components/coders/CoderMark";
import { SavedFilters } from "./SavedFilters";
import { QueryBuilder } from "./QueryBuilder";
import type { DescriptorFilter, ExcerptFilter, Query, WeightRangeFilter } from "@/api/types";
import { Input } from "@/components/ui/input";

interface Props {
  codeIds: string[];
  onCodeIds: (v: string[]) => void;
  codeSetIds: string[];
  onCodeSetIds: (v: string[]) => void;
  includeDescendants: boolean;
  onIncludeDescendants: (v: boolean) => void;
  requireAllCodes: boolean;
  onRequireAllCodes: (v: boolean) => void;
  documentIds: string[];
  onDocumentIds: (v: string[]) => void;
  documentSetIds: string[];
  onDocumentSetIds: (v: string[]) => void;
  uncodedOnly: boolean;
  onUncodedOnly: (v: boolean) => void;
  /** Set only by the analysis views' click-through; shown as a removable chip. */
  overlapsCodeId: string | null;
  onOverlapsCodeId: (v: string | null) => void;
  descriptors: DescriptorFilter[];
  onDescriptors: (v: DescriptorFilter[]) => void;
  /** The Boolean/proximity query, built by the "Query" chip. */
  query: Query | null;
  onQuery: (v: Query | null) => void;
  /** Only what these speakers said; empty is no filter. */
  speakers: string[];
  onSpeakers: (v: string[]) => void;
  /** Only excerpts coded by these coders; empty means everyone. */
  coderIds: string[];
  onCoderIds: (v: string[]) => void;
  /** Only a coding of one weighted code whose value falls in this range. */
  weightRange: WeightRangeFilter | null;
  onWeightRange: (v: WeightRangeFilter | null) => void;
  /** The filter as it stands, for "Save current filter…". */
  filter: ExcerptFilter;
  onApplyFilter: (filter: ExcerptFilter) => void;
  total: number;
}

export function ExcerptFilters(p: Props) {
  const { t } = useTranslation();
  const tree = useCodeTree();
  const { data: docs } = useDocuments();
  const { data: codeSets } = useSets("code");
  const { data: docSets } = useSets("document");
  const { data: projectSpeakers } = useProjectSpeakers();
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const codeCount = p.codeIds.length + p.codeSetIds.length;
  const docCount = p.documentIds.length + p.documentSetIds.length;
  const overlapsCode = p.overlapsCodeId
    ? flattenTree(tree).find((n) => n.code.id === p.overlapsCodeId)?.code
    : undefined;
  const weightedCodes = flattenTree(tree)
    .map((n) => n.code)
    .filter((c) => c.weightScale);
  const weightCode = p.weightRange
    ? weightedCodes.find((c) => c.id === p.weightRange!.codeId)
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2 text-sm">
      <h2 className="mr-2 font-serif text-lg font-medium">{t("excerpts.filters.title")}</h2>
      <FilterPicker
        label={
          codeCount
            ? t(
                p.codeSetIds.length
                  ? "excerpts.filters.codeCountWithSet"
                  : "excerpts.filters.codeCount",
                {
                  count: codeCount,
                },
              )
            : t("excerpts.filters.anyCode")
        }
        active={codeCount > 0}
        onClear={() => {
          p.onCodeIds([]);
          p.onCodeSetIds([]);
        }}
        testId="filter-codes"
      >
        {(query) => (
          <>
            <label className="mb-1 flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={p.includeDescendants}
                onChange={(e) => p.onIncludeDescendants(e.target.checked)}
              />
              {t("excerpts.filters.includeSubcodes")}
            </label>
            <label className="mb-1 flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={p.requireAllCodes}
                onChange={(e) => p.onRequireAllCodes(e.target.checked)}
                data-testid="filter-require-all"
              />
              {t("excerpts.filters.matchAllCodes")}
            </label>
            <SetsPickerGroup
              sets={codeSets}
              query={query}
              picked={p.codeSetIds}
              onToggle={(id) => p.onCodeSetIds(toggle(p.codeSetIds, id))}
            />
            {flattenTree(tree)
              .filter((n) => pathOf(tree, n.code.id).toLowerCase().includes(query.toLowerCase()))
              .map((n) => (
                <label
                  key={n.code.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                  style={{ paddingLeft: 8 + n.depth * 12 }}
                >
                  <input
                    type="checkbox"
                    checked={p.codeIds.includes(n.code.id)}
                    onChange={() => p.onCodeIds(toggle(p.codeIds, n.code.id))}
                  />
                  <ColorDot color={n.code.color} />
                  <span className="truncate">{n.code.name}</span>
                </label>
              ))}
          </>
        )}
      </FilterPicker>
      <FilterPicker
        label={
          docCount
            ? t(
                p.documentSetIds.length
                  ? "excerpts.filters.documentCountWithSet"
                  : "excerpts.filters.documentCount",
                { count: docCount },
              )
            : t("excerpts.filters.anyDocument")
        }
        active={docCount > 0}
        onClear={() => {
          p.onDocumentIds([]);
          p.onDocumentSetIds([]);
        }}
        testId="filter-documents"
      >
        {(query) => (
          <>
            <SetsPickerGroup
              sets={docSets}
              query={query}
              picked={p.documentSetIds}
              onToggle={(id) => p.onDocumentSetIds(toggle(p.documentSetIds, id))}
            />
            {docs
              ?.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
              .map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={p.documentIds.includes(d.id)}
                    onChange={() => p.onDocumentIds(toggle(p.documentIds, d.id))}
                  />
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
          </>
        )}
      </FilterPicker>
      {codeCount > 1 ? (
        <span className="text-xs text-fg-muted" data-testid="code-match-mode">
          {p.requireAllCodes ? t("excerpts.filters.matchAllOf") : t("excerpts.filters.matchAnyOf")}
        </span>
      ) : null}
      {p.overlapsCodeId ? (
        <span
          className="flex items-center gap-1 rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs"
          data-testid="overlaps-code-chip"
        >
          {t("excerpts.filters.overlapping", { name: overlapsCode?.name ?? p.overlapsCodeId })}
          <button
            className="rounded p-0.5 text-fg-muted hover:bg-muted"
            onClick={() => p.onOverlapsCodeId(null)}
            aria-label={t("excerpts.filters.removeOverlapping", {
              name: overlapsCode?.name ?? p.overlapsCodeId,
            })}
          >
            <X className="size-3" />
          </button>
        </span>
      ) : null}
      {projectSpeakers?.length ? (
        <FilterPicker
          label={
            p.speakers.length
              ? t("excerpts.filters.speakerCount", { count: p.speakers.length })
              : t("excerpts.filters.anySpeaker")
          }
          active={p.speakers.length > 0}
          onClear={() => p.onSpeakers([])}
          testId="filter-speakers"
        >
          {(query) => (
            <>
              {projectSpeakers
                .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
                .map((name) => (
                  <label
                    key={name}
                    className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={p.speakers.includes(name)}
                      onChange={() => p.onSpeakers(toggle(p.speakers, name))}
                    />
                    <span className="truncate">{name}</span>
                  </label>
                ))}
            </>
          )}
        </FilterPicker>
      ) : null}
      <CoderFilter coderIds={p.coderIds} onChange={p.onCoderIds} />
      {weightedCodes.length > 0 ? (
        <FilterPicker
          label={
            p.weightRange
              ? t("excerpts.filters.weightLabel", {
                  name: weightCode?.name ?? p.weightRange.codeId,
                  min: p.weightRange.min,
                  max: p.weightRange.max,
                })
              : t("excerpts.filters.weightBetween")
          }
          active={!!p.weightRange}
          onClear={() => p.onWeightRange(null)}
          testId="filter-weight"
        >
          {(query) => (
            <div className="min-w-56">
              {p.weightRange && weightCode?.weightScale ? (
                <div className="flex items-center gap-2 border-b border-border px-2 pb-2">
                  <Input
                    type="number"
                    aria-label={t("excerpts.filters.minWeight")}
                    className="h-7"
                    min={weightCode.weightScale.min}
                    max={weightCode.weightScale.max}
                    step={weightCode.weightScale.step}
                    value={p.weightRange.min}
                    onChange={(e) =>
                      p.onWeightRange({ ...p.weightRange!, min: Number(e.target.value) })
                    }
                  />
                  <span className="text-fg-muted">–</span>
                  <Input
                    type="number"
                    aria-label={t("excerpts.filters.maxWeight")}
                    className="h-7"
                    min={weightCode.weightScale.min}
                    max={weightCode.weightScale.max}
                    step={weightCode.weightScale.step}
                    value={p.weightRange.max}
                    onChange={(e) =>
                      p.onWeightRange({ ...p.weightRange!, max: Number(e.target.value) })
                    }
                  />
                </div>
              ) : null}
              {weightedCodes
                .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
                .map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="weight-filter-code"
                      checked={p.weightRange?.codeId === c.id}
                      onChange={() =>
                        p.onWeightRange({
                          codeId: c.id,
                          min: c.weightScale!.min,
                          max: c.weightScale!.max,
                        })
                      }
                    />
                    <ColorDot color={c.color} />
                    <span className="truncate">{c.name}</span>
                  </label>
                ))}
            </div>
          )}
        </FilterPicker>
      ) : null}
      <DescriptorConditions conditions={p.descriptors} onChange={p.onDescriptors} />
      <QueryBuilder query={p.query} onChange={p.onQuery} />
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={p.uncodedOnly}
          onChange={(e) => p.onUncodedOnly(e.target.checked)}
        />
        {t("excerpts.filters.uncodedOnly")}
      </label>
      <SavedFilters current={p.filter} onApply={p.onApplyFilter} />
      <span className="ml-auto text-xs text-fg-muted" data-testid="excerpt-total">
        {t("excerpts.filters.total", { count: p.total })}
      </span>
    </div>
  );
}
