import { useState } from "react";
import { Settings2 } from "lucide-react";
import { KIND_LABELS } from "@/core/descriptors";
import { Button } from "@/components/ui/button";
import { useDescriptorFields, useDescriptorMatrix } from "@/queries/descriptors";
import { useWorkspace } from "@/state/workspace";
import { DescriptorsDialog } from "./DescriptorsDialog";
import { DescriptorValueInput } from "./DescriptorValueInput";

/** Every document against every descriptor, editable in place. */
export function DescriptorTable() {
  const { data: fields } = useDescriptorFields();
  const { data: matrix } = useDescriptorMatrix();
  const openDocument = useWorkspace((s) => s.openDocument);
  const [manage, setManage] = useState(false);
  const list = fields ?? [];

  return (
    <div className="flex h-full flex-col" data-testid="descriptor-table">
      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <h2 className="mr-2 font-serif text-lg font-medium">Descriptors</h2>
        <Button variant="outline" size="sm" onClick={() => setManage(true)}>
          <Settings2 /> Manage fields
        </Button>
        <span className="ml-auto text-xs text-fg-muted">
          {matrix?.rows.length ?? 0} document{matrix?.rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {list.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">
            No descriptors yet. Add fields for the attributes you compare across, such as site,
            interview wave or age group.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr>
                <th className="border-b border-border px-3 py-2 text-left font-medium">Document</th>
                {list.map((f) => (
                  <th key={f.id} className="border-b border-border px-3 py-2 text-left font-medium">
                    {f.name}
                    <span className="ml-1 text-[10px] uppercase text-fg-muted">
                      {KIND_LABELS[f.kind]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix?.rows.map((row) => (
                <tr key={row.documentId} className="hover:bg-muted/50">
                  <td className="border-b border-border px-3 py-1.5">
                    <button
                      className="truncate text-left hover:underline"
                      onClick={() => openDocument(row.documentId)}
                    >
                      {row.documentName}
                    </button>
                  </td>
                  {list.map((f) => {
                    const value = row.values[f.id] ?? "";
                    return (
                      <td key={f.id} className="border-b border-border px-2 py-1">
                        <DescriptorValueInput
                          // Reset the draft when the stored value changes.
                          key={`${row.documentId}:${f.id}:${value}`}
                          documentId={row.documentId}
                          field={f}
                          value={value}
                          className="min-w-32"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {manage ? <DescriptorsDialog onClose={() => setManage(false)} /> : null}
    </div>
  );
}
