// Pure helpers for descriptors (document attributes): which operators suit
// which field kind, how many operands each one takes, and how a condition
// reads as a chip. No React, no Tauri.

import type { DescriptorField, DescriptorFilter, DescriptorKind, DescriptorOp } from "@/api/types";

/** A translator, so this module can hand back localized labels and
 * sentences without importing react/i18next itself (src/core stays
 * framework-free — see CLAUDE.md). The caller passes `useTranslation()`'s
 * `t`. */
export type DescriptorsT = (key: string, params?: Record<string, unknown>) => string;

export const KIND_LABEL_KEYS: Record<DescriptorKind, string> = {
  text: "descriptors.kind.text",
  number: "descriptors.kind.number",
  choice: "descriptors.kind.choice",
  date: "descriptors.kind.date",
};

export const OP_LABEL_KEYS: Record<DescriptorOp, string> = {
  eq: "descriptors.op.eq",
  neq: "descriptors.op.neq",
  contains: "descriptors.op.contains",
  gt: "descriptors.op.gt",
  lt: "descriptors.op.lt",
  between: "descriptors.op.between",
  in: "descriptors.op.in",
  empty: "descriptors.op.empty",
  notEmpty: "descriptors.op.notEmpty",
};

/** `gt`/`lt` read differently on numbers than on dates. */
export function opLabel(op: DescriptorOp, kind: DescriptorKind, t: DescriptorsT): string {
  if (kind === "number" && op === "gt") return t("descriptors.op.gtNumber");
  if (kind === "number" && op === "lt") return t("descriptors.op.ltNumber");
  return t(OP_LABEL_KEYS[op]);
}

const OPS: Record<DescriptorKind, DescriptorOp[]> = {
  text: ["contains", "eq", "neq", "empty", "notEmpty"],
  number: ["eq", "neq", "gt", "lt", "between", "empty", "notEmpty"],
  choice: ["eq", "neq", "in", "empty", "notEmpty"],
  date: ["eq", "neq", "gt", "lt", "between", "empty", "notEmpty"],
};

/** The operators worth offering for a field of this kind. */
export function opsForKind(kind: DescriptorKind): DescriptorOp[] {
  return OPS[kind] ?? OPS.text;
}

/** How many operands an operator takes; `in` takes one or more. */
export function operandCount(op: DescriptorOp): 0 | 1 | 2 | "many" {
  switch (op) {
    case "empty":
    case "notEmpty":
      return 0;
    case "between":
      return 2;
    case "in":
      return "many";
    default:
      return 1;
  }
}

/** True when the condition has everything the backend needs. */
export function isConditionComplete(c: DescriptorFilter): boolean {
  const filled = c.values.filter((v) => v.trim() !== "");
  const n = operandCount(c.op);
  if (n === 0) return true;
  if (n === "many") return filled.length >= 1;
  return filled.length >= n && c.values.slice(0, n).every((v) => v.trim() !== "");
}

/** Drop empty operands and trim what is left, ready to send. */
export function normalizeCondition(c: DescriptorFilter): DescriptorFilter {
  const n = operandCount(c.op);
  const values =
    n === 0
      ? []
      : c.values
          .map((v) => v.trim())
          .filter((v) => v !== "")
          .slice(0, n === "many" ? undefined : n);
  return { fieldId: c.fieldId, op: c.op, values };
}

/** A condition with sensible defaults after the field or operator changes. */
export function defaultCondition(field: DescriptorField): DescriptorFilter {
  const op = opsForKind(field.kind)[0] ?? "eq";
  return { fieldId: field.id, op, values: field.kind === "choice" ? [] : [""] };
}

/** "Site is any of North, South" — the label of a filter chip. */
export function describeCondition(
  c: DescriptorFilter,
  fields: DescriptorField[],
  t: DescriptorsT,
): string {
  const field = fields.find((f) => f.id === c.fieldId);
  const name = field?.name ?? t("descriptors.genericName");
  const label = opLabel(c.op, field?.kind ?? "text", t);
  const n = operandCount(c.op);
  if (n === 0) return `${name} ${label}`;
  if (c.op === "between") return `${name} ${label} ${c.values[0] ?? ""}–${c.values[1] ?? ""}`;
  return `${name} ${label} ${c.values.filter((v) => v !== "").join(", ")}`;
}

/** The options editor edits one option per line. */
export function parseOptions(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const option = line.trim();
    if (option && !out.some((o) => o.toLowerCase() === option.toLowerCase())) out.push(option);
  }
  return out;
}
