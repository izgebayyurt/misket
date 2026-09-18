import { useState } from "react";
import type { FrameworkMatrix, FrameworkMatrixInput } from "@/api/types";
import { flattenTree } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import { useDescriptorFields } from "@/queries/descriptors";
import { useSets } from "@/queries/sets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ColorDot } from "@/components/codebook/ColorSwatch";

type RowMode = "all" | "set" | "descriptor";
type ColumnMode = "codes" | "set";

const SELECT =
  "h-8 w-full rounded-md border border-border-strong bg-panel px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</p>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 py-0.5 text-sm">
      <input type="radio" checked={checked} onChange={onChange} />
      {children}
    </label>
  );
}

/**
 * Create or reconfigure a framework matrix: what the rows are (every
 * document, a document set, or one row per value of a descriptor field) and
 * where the columns come from (a code set, or a hand-picked list of codes).
 */
export function FrameworkMatrixDialog({
  matrix,
  onSubmit,
  onClose,
}: {
  /** The matrix being reconfigured, or null to create one. */
  matrix: FrameworkMatrix | null;
  onSubmit: (input: FrameworkMatrixInput) => void;
  onClose: () => void;
}) {
  const tree = useCodeTree();
  const { data: fields } = useDescriptorFields();
  const { data: documentSets } = useSets("document");
  const { data: codeSets } = useSets("code");

  const [name, setName] = useState(matrix?.name ?? "");
  const [rowMode, setRowMode] = useState<RowMode>(
    matrix?.rowKind === "descriptor_value" ? "descriptor" : matrix?.rowSetId ? "set" : "all",
  );
  const [rowSetId, setRowSetId] = useState(matrix?.rowSetId ?? "");
  const [rowFieldId, setRowFieldId] = useState(matrix?.rowFieldId ?? "");
  const [columnMode, setColumnMode] = useState<ColumnMode>(matrix?.codeSetId ? "set" : "codes");
  const [codeSetId, setCodeSetId] = useState(matrix?.codeSetId ?? "");
  const [codeIds, setCodeIds] = useState<string[]>(matrix?.codeIds ?? []);

  const nodes = flattenTree(tree);
  const invalid =
    !name.trim() ||
    (rowMode === "descriptor" && !rowFieldId) ||
    (rowMode === "set" && !rowSetId) ||
    (columnMode === "set" ? !codeSetId : codeIds.length === 0);

  function submit() {
    if (invalid) return;
    onSubmit({
      name: name.trim(),
      rowKind: rowMode === "descriptor" ? "descriptor_value" : "document",
      rowFieldId: rowMode === "descriptor" ? rowFieldId : null,
      rowSetId: rowMode === "set" ? rowSetId : null,
      codeSetId: columnMode === "set" ? codeSetId : null,
      // Columns keep the codebook's order, which is the order they are listed.
      codeIds:
        columnMode === "codes"
          ? nodes.map((n) => n.code.id).filter((id) => codeIds.includes(id))
          : [],
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={matrix ? "Configure matrix" : "New framework matrix"}
        description="Cases down the side, themes across the top; you write the summary in each cell."
        className="max-w-lg"
      >
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            placeholder="Access to care, wave 1"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            data-testid="framework-name"
          />
        </Field>

        <Field label="Rows (cases)">
          <Radio checked={rowMode === "all"} onChange={() => setRowMode("all")}>
            Every document
          </Radio>
          <Radio checked={rowMode === "set"} onChange={() => setRowMode("set")}>
            Documents in a set
          </Radio>
          {rowMode === "set" ? (
            <select
              className={SELECT}
              value={rowSetId}
              onChange={(e) => setRowSetId(e.target.value)}
              data-testid="framework-row-set"
            >
              <option value="">Choose a document set…</option>
              {documentSets?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <Radio checked={rowMode === "descriptor"} onChange={() => setRowMode("descriptor")}>
            One row per value of a descriptor
          </Radio>
          {rowMode === "descriptor" ? (
            <select
              className={SELECT}
              value={rowFieldId}
              onChange={(e) => setRowFieldId(e.target.value)}
              data-testid="framework-row-field"
            >
              <option value="">Choose a field…</option>
              {fields?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : null}
        </Field>

        <Field label="Columns (themes)">
          <Radio checked={columnMode === "set"} onChange={() => setColumnMode("set")}>
            Codes in a set
          </Radio>
          {columnMode === "set" ? (
            <select
              className={SELECT}
              value={codeSetId}
              onChange={(e) => setCodeSetId(e.target.value)}
              data-testid="framework-code-set"
            >
              <option value="">Choose a code set…</option>
              {codeSets?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <Radio checked={columnMode === "codes"} onChange={() => setColumnMode("codes")}>
            Picked codes
          </Radio>
          {columnMode === "codes" ? (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border p-1">
              {nodes.length === 0 ? (
                <p className="p-2 text-sm text-fg-muted">The codebook is empty.</p>
              ) : null}
              {nodes.map((n) => (
                <label
                  key={n.code.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                  style={{ paddingLeft: 8 + n.depth * 14 }}
                >
                  <input
                    type="checkbox"
                    checked={codeIds.includes(n.code.id)}
                    onChange={() =>
                      setCodeIds((ids) =>
                        ids.includes(n.code.id)
                          ? ids.filter((x) => x !== n.code.id)
                          : [...ids, n.code.id],
                      )
                    }
                    data-testid="framework-code-option"
                  />
                  <ColorDot color={n.code.color} />
                  <span className="min-w-0 flex-1 truncate">{n.code.name}</span>
                </label>
              ))}
            </div>
          ) : null}
        </Field>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={invalid} data-testid="framework-save">
            {matrix ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
