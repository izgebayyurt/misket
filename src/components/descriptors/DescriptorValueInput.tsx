import { useState } from "react";
import type { DescriptorField } from "@/api/types";
import { Input } from "@/components/ui/input";
import { useSetDescriptorValue } from "@/queries/descriptors";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { selectClass } from "./DescriptorFieldForm";

/**
 * One document's value for one field. Text, number and date fields commit on
 * blur or Enter (Escape puts the stored value back); a choice field commits on
 * change. Mount it with a key that includes `value` so the draft resets when
 * the stored value changes under it (an undo, say).
 */
export function DescriptorValueInput({
  documentId,
  field,
  value,
  id,
  className,
}: {
  documentId: string;
  field: DescriptorField;
  value: string;
  id?: string;
  className?: string;
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
        previous: value === "" ? null : value,
        fieldName: field.name,
      });
      setError(false);
    } catch (e) {
      setError(true);
      setDraft(value);
      toast.error(e);
    }
  }

  if (field.kind === "choice") {
    return (
      <select
        id={id}
        className={cn(selectClass, className)}
        value={value}
        onChange={(e) => commit(e.target.value)}
        aria-label={field.name}
        data-testid="descriptor-value"
      >
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      id={id}
      className={cn(className, error && "border-danger")}
      type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
      step={field.kind === "number" ? "any" : undefined}
      value={draft}
      aria-label={field.name}
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
  );
}
