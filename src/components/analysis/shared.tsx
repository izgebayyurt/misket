import { save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { writeTextFile } from "@/api/project";
import { useDocuments } from "@/queries/documents";
import { useProjectInfo } from "@/queries/project";
import { FilterPicker } from "@/components/ui/filter-picker";
import { Button } from "@/components/ui/button";
import { toast } from "@/state/toasts";

/** A document multi-select shared by the analysis views. */
export function DocumentFilter({
  documentIds,
  onChange,
}: {
  documentIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: docs } = useDocuments();
  return (
    <FilterPicker
      label={
        documentIds.length
          ? `${documentIds.length} document${documentIds.length > 1 ? "s" : ""}`
          : "All documents"
      }
      active={documentIds.length > 0}
      onClear={() => onChange([])}
      testId="analysis-filter-documents"
    >
      {(query) => (
        <>
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
