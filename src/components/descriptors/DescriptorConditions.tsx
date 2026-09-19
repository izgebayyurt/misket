import { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DescriptorField, DescriptorFilter, DescriptorOp } from "@/api/types";
import {
  defaultCondition,
  describeCondition,
  isConditionComplete,
  normalizeCondition,
  opLabel,
  operandCount,
  opsForKind,
} from "@/core/descriptors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDescriptorFields } from "@/queries/descriptors";
import { selectClass } from "./DescriptorFieldForm";

/**
 * The "Descriptors" filter chip in the excerpt browser: a small builder that
 * appends one condition at a time, plus a chip per active condition. All the
 * conditions are ANDed by the backend.
 */
export function DescriptorConditions({
  conditions,
  onChange,
}: {
  conditions: DescriptorFilter[];
  onChange: (v: DescriptorFilter[]) => void;
}) {
  const { t } = useTranslation();
  const { data: fields } = useDescriptorFields();
  const [open, setOpen] = useState(false);

  // A field deleted elsewhere leaves a condition the backend would reject.
  useEffect(() => {
    if (!fields) return;
    const kept = conditions.filter((c) => fields.some((f) => f.id === c.fieldId));
    if (kept.length !== conditions.length) onChange(kept);
  }, [fields, conditions, onChange]);

  if (!fields || fields.length === 0) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted",
              conditions.length > 0 && "border-accent bg-accent/10 text-fg",
            )}
            data-testid="filter-descriptors"
          >
            {t("descriptors.filterChip")} <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3">
          <ConditionBuilder
            fields={fields}
            onAdd={(c) => {
              onChange([...conditions, c]);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {conditions.map((c, i) => (
        <span
          key={`${c.fieldId}-${c.op}-${i}`}
          className="flex items-center gap-1 rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs"
          data-testid="descriptor-chip"
        >
          {describeCondition(c, fields, t)}
          <button
            className="rounded p-0.5 text-fg-muted hover:bg-muted"
            onClick={() => onChange(conditions.filter((_, j) => j !== i))}
            aria-label={t("descriptors.removeCondition", {
              condition: describeCondition(c, fields, t),
            })}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </>
  );
}

function ConditionBuilder({
  fields,
  onAdd,
}: {
  fields: DescriptorField[];
  onAdd: (c: DescriptorFilter) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DescriptorFilter>(() => defaultCondition(fields[0]!));
  const field = fields.find((f) => f.id === draft.fieldId) ?? fields[0]!;
  const ops = opsForKind(field.kind);
  const count = operandCount(draft.op);
  const setValue = (i: number, v: string) => {
    const values = [...draft.values];
    values[i] = v;
    setDraft({ ...draft, values });
  };
  const inputType = field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text";

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (isConditionComplete(draft)) onAdd(normalizeCondition(draft));
      }}
    >
      <select
        className={selectClass}
        value={field.id}
        onChange={(e) => {
          const next = fields.find((f) => f.id === e.target.value)!;
          setDraft(defaultCondition(next));
        }}
        aria-label={t("analysis.descriptor.fieldLabel")}
        data-testid="condition-field"
      >
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        value={draft.op}
        onChange={(e) => {
          const op = e.target.value as DescriptorOp;
          const n = operandCount(op);
          setDraft({
            ...draft,
            op,
            values: n === 0 ? [] : n === "many" ? [] : draft.values.slice(0, n),
          });
        }}
        aria-label={t("excerpts.query.operator")}
        data-testid="condition-op"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {opLabel(op, field.kind, t)}
          </option>
        ))}
      </select>
      {count === "many" && field.kind === "choice" ? (
        <div className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
          {field.options.map((o) => (
            <label key={o} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
              <input
                type="checkbox"
                checked={draft.values.includes(o)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    values: e.target.checked
                      ? [...draft.values, o]
                      : draft.values.filter((v) => v !== o),
                  })
                }
              />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      ) : count === 0 ? null : field.kind === "choice" ? (
        <select
          className={selectClass}
          value={draft.values[0] ?? ""}
          onChange={(e) => setValue(0, e.target.value)}
          aria-label={t("descriptors.value")}
          data-testid="condition-value"
        >
          <option value="">{t("descriptors.choose")}</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={inputType}
            step={field.kind === "number" ? "any" : undefined}
            value={draft.values[0] ?? ""}
            onChange={(e) => setValue(0, e.target.value)}
            placeholder={t("descriptors.value")}
            aria-label={t("descriptors.value")}
            data-testid="condition-value"
          />
          {count === 2 ? (
            <>
              <span className="text-xs text-fg-muted">{t("descriptors.and")}</span>
              <Input
                type={inputType}
                step={field.kind === "number" ? "any" : undefined}
                value={draft.values[1] ?? ""}
                onChange={(e) => setValue(1, e.target.value)}
                placeholder={t("descriptors.value")}
                aria-label={t("descriptors.secondValue")}
              />
            </>
          ) : null}
        </div>
      )}
      <Button
        type="submit"
        size="sm"
        className="w-full"
        disabled={!isConditionComplete(draft)}
        data-testid="add-condition"
      >
        {t("descriptors.addCondition")}
      </Button>
    </form>
  );
}
