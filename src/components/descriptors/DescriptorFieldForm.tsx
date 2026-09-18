import { useState } from "react";
import type { DescriptorField, DescriptorKind } from "@/api/types";
import { KIND_LABELS, parseOptions } from "@/core/descriptors";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const KINDS: DescriptorKind[] = ["text", "number", "choice", "date"];

export const selectClass =
  "h-8 w-full rounded-md border border-border-strong bg-panel px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

/** Add or edit one descriptor field: name, kind and (for choice) its options. */
export function DescriptorFieldForm({
  field,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
}: {
  field?: DescriptorField;
  submitLabel: string;
  onSubmit: (v: { name: string; kind: DescriptorKind; options: string[] }) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [kind, setKind] = useState<DescriptorKind>(field?.kind ?? "text");
  const [optionsText, setOptionsText] = useState((field?.options ?? []).join("\n"));
  const options = parseOptions(optionsText);
  const frozenKind = (field?.valueCount ?? 0) > 0;
  const valid = name.trim() !== "" && (kind !== "choice" || options.length > 0);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ name: name.trim(), kind, options });
      }}
      data-testid="descriptor-form"
    >
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <label className="text-xs font-medium text-fg-muted" htmlFor="descriptor-name">
            Name
          </label>
          <Input
            id="descriptor-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Age group"
            className="mt-1"
            data-testid="descriptor-name"
          />
        </div>
        <div className="w-32">
          <label className="text-xs font-medium text-fg-muted" htmlFor="descriptor-kind">
            Type
          </label>
          <select
            id="descriptor-kind"
            className={cn(selectClass, "mt-1")}
            value={kind}
            disabled={frozenKind}
            title={
              frozenKind
                ? `${field?.valueCount} document${field?.valueCount === 1 ? " has" : "s have"} a value; clear them to change the type`
                : undefined
            }
            onChange={(e) => setKind(e.target.value as DescriptorKind)}
            data-testid="descriptor-kind"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {kind === "choice" ? (
        <div>
          <label className="text-xs font-medium text-fg-muted" htmlFor="descriptor-options">
            Options, one per line
          </label>
          <Textarea
            id="descriptor-options"
            rows={4}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={"18–29\n30–44\n45+"}
            className="mt-1 font-mono text-xs"
            data-testid="descriptor-options"
          />
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={!valid || busy} data-testid="descriptor-submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
