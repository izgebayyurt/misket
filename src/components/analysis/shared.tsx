import { save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { writeTextFile } from "@/api/project";
import { flattenTree, pathOf } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import { useDocuments } from "@/queries/documents";
import { useProjectInfo } from "@/queries/project";
import { useSets } from "@/queries/sets";
import { FilterPicker } from "@/components/ui/filter-picker";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { SetsPickerGroup } from "@/components/sets/SetsPickerGroup";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

/**
 * A document multi-select shared by the analysis views, with the same
 * "Sets" group the excerpt browser's document picker has: a document set
 * stands for all of its members, unioned into `documentIds` on the Rust
 * side.
 */
export function DocumentFilter({
  documentIds,
  onChange,
  documentSetIds,
  onSetIdsChange,
}: {
  documentIds: string[];
  onChange: (ids: string[]) => void;
  documentSetIds: string[];
  onSetIdsChange: (ids: string[]) => void;
}) {
  const { data: docs } = useDocuments();
  const { data: docSets } = useSets("document");
  const count = documentIds.length + documentSetIds.length;
  return (
    <FilterPicker
      label={
        count
          ? `${count} document${count > 1 ? "s" : ""}${documentSetIds.length ? " / set" : ""}`
          : "All documents"
      }
      active={count > 0}
      onClear={() => {
        onChange([]);
        onSetIdsChange([]);
      }}
      testId="analysis-filter-documents"
    >
      {(query) => (
        <>
          <SetsPickerGroup
            sets={docSets}
            query={query}
            picked={documentSetIds}
            onToggle={(id) =>
              onSetIdsChange(
                documentSetIds.includes(id)
                  ? documentSetIds.filter((x) => x !== id)
                  : [...documentSetIds, id],
              )
            }
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
                  checked={documentIds.includes(d.id)}
                  onChange={() =>
                    onChange(
                      documentIds.includes(d.id)
                        ? documentIds.filter((x) => x !== d.id)
                        : [...documentIds, d.id],
                    )
                  }
                />
                <span className="truncate">{d.name}</span>
              </label>
            ))}
        </>
      )}
    </FilterPicker>
  );
}

/** A code multi-select, shaped like `DocumentFilter`: pick any number of
 * codes, each standing for itself plus (per `includeDescendants` in the
 * caller) its sub-codes. Used to scope the word-frequency view to text
 * that's been coded a particular way. */
export function CodeFilter({
  codeIds,
  onChange,
}: {
  codeIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const tree = useCodeTree();
  const nodes = flattenTree(tree);
  const count = codeIds.length;
  return (
    <FilterPicker
      label={count ? `${count} code${count > 1 ? "s" : ""}` : "Any code"}
      active={count > 0}
      onClear={() => onChange([])}
      testId="analysis-filter-codes"
    >
      {(query) =>
        nodes
          .filter((n) => pathOf(tree, n.code.id).toLowerCase().includes(query.toLowerCase()))
          .map((n) => (
            <label
              key={n.code.id}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
              style={{ paddingLeft: 8 + n.depth * 12 }}
            >
              <input
                type="checkbox"
                checked={codeIds.includes(n.code.id)}
                onChange={() =>
                  onChange(
                    codeIds.includes(n.code.id)
                      ? codeIds.filter((x) => x !== n.code.id)
                      : [...codeIds, n.code.id],
                  )
                }
              />
              <ColorDot color={n.code.color} />
              <span className="truncate">{n.code.name}</span>
            </label>
          ))
      }
    </FilterPicker>
  );
}

/** A single-code picker ("All codes" plus every code, tree order), for
 * narrowing a chart or table to one code at a time. */
export function CodePicker({
  value,
  onChange,
  allLabel = "All codes",
  testId = "code-picker",
}: {
  value: string | null;
  onChange: (codeId: string | null) => void;
  allLabel?: string;
  testId?: string;
}) {
  const tree = useCodeTree();
  const nodes = flattenTree(tree);
  const selected = value ? tree.byId.get(value) : undefined;
  const row = (label: string, active: boolean, onClick: () => void, depth = 0, color?: string) => (
    <button
      key={label + depth}
      type="button"
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted",
        active && "bg-accent/10 font-medium text-fg",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={onClick}
    >
      {color ? <ColorDot color={color} /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <FilterPicker
      label={selected ? selected.code.name : allLabel}
      active={!!value}
      onClear={() => onChange(null)}
      testId={testId}
    >
      {(query) => (
        <>
          {!query ? row(allLabel, !value, () => onChange(null)) : null}
          {nodes
            .filter((n) => pathOf(tree, n.code.id).toLowerCase().includes(query.toLowerCase()))
            .map((n) =>
              row(
                n.code.name,
                value === n.code.id,
                () => onChange(n.code.id),
                n.depth,
                n.code.color,
              ),
            )}
        </>
      )}
    </FilterPicker>
  );
}

/**
 * Save a CSV the frontend built. The dialog plugin picks the path and a tiny
 * Rust command writes it, so the webview needs no filesystem permissions.
 */
export function ExportCsvButton({
  name,
  build,
  disabled,
}: {
  /** File name stem, e.g. "code-frequencies". */
  name: string;
  build: () => string;
  disabled?: boolean;
}) {
  const { data: project } = useProjectInfo();
  async function run() {
    try {
      const stem = (project?.name ?? "misket").replace(/[^\w.-]+/g, "_") || "misket";
      const path = await save({
        defaultPath: `${stem}-${name}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await writeTextFile(path, build());
      toast.info(`Exported to ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={disabled} data-testid="export-csv">
      <Download /> CSV
    </Button>
  );
}

export function AnalysisToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2 text-sm">
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-sm text-fg-muted">{children}</p>;
}
