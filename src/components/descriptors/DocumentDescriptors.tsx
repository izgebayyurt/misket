import { useState } from "react";
import { Settings2 } from "lucide-react";
import type { DescriptorField } from "@/api/types";
import {
  useDescriptorFields,
  useDocumentDescriptorValues,
  useSetDescriptorValue,
} from "@/queries/descriptors";
import { Input } from "@/components/ui/input";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { DescriptorsDialog } from "./DescriptorsDialog";
import { selectClass } from "./DescriptorFieldForm";

/** The document's attribute values, one input per field. */
export function DocumentDescriptors({ documentId }: { documentId: string }) {
  const { data: fields } = useDescriptorFields();
  const { data: values } = useDocumentDescriptorValues(documentId);
  const [manage, setManage] = useState(false);

  return (
    <section className="border-b border-border p-3" data-testid="document-descriptors">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Descriptors</h3>
        <button
          className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
          onClick={() => setManage(true)}
          title="Manage descriptors"
          aria-label="Manage descriptors"
        >
          <Settings2 className="size-4" />
        </button>
      </div>
      {fields && fields.length === 0 ? (
        <p className="mt-1 text-xs text-fg-muted">
          No descriptors yet.{" "}
          <button
            className="text-accent underline-offset-2 hover:underline"
            onClick={() => setManage(true)}
          >
            Define some
          </button>{" "}
          to record attributes like site or interview wave.
        </p>
      ) : null}
      <div className="mt-2 space-y-2">
        {fields?.map((f) => {
          const value = values?.find((v) => v.fieldId === f.id)?.value ?? "";
          return (
            // Keying on the stored value resets the draft when it changes
            // under us (an undo, or switching document).
            <DescriptorInput
              key={`${f.id}:${documentId}:${value}`}
              documentId={documentId}
              field={f}
              value={value}
            />
          );
        })}
      </div>
      {manage ? <DescriptorsDialog onClose={() => setManage(false)} /> : null}
    </section>
  );
}

function DescriptorInput({
  documentId,
  field,
  value,
}: {
  documentId: string;
  field: DescriptorField;
  value: string;
}) {
  const set = useSetDescriptorValue();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState(false);

  async function commit(next: string) {
    if (next === value) return;
    try {
      await set.mutateAsync({
        documentId,
        fieldId: field.id,
        value: next === "" ? null : next,
        fieldName: field.name,
      });
      setError(false);
    } catch (e) {
      setError(true);
      setDraft(value);
      toast.error(e);
    }
  }

  const id = `descriptor-${field.id}`;
  return (
    <div>
      <label className="text-xs font-medium text-fg-muted" htmlFor={id}>
        {field.name}
      </label>
      {field.kind === "choice" ? (
        <select
          id={id}
          className={cn(selectClass, "mt-1")}
          value={value}
          onChange={(e) => commit(e.target.value)}
          data-testid="descriptor-value"
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          className={cn("mt-1", error && "border-danger")}
          type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
          step={field.kind === "number" ? "any" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value);
              e.currentTarget.blur();
            }
          }}
          data-testid="descriptor-value"
        />
      )}
    </div>
  );
}
