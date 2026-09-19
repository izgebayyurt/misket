import { describe, expect, it } from "vitest";
import type { DescriptorField } from "@/api/types";
import i18n from "@/lib/i18n";
import {
  defaultCondition,
  describeCondition,
  isConditionComplete,
  normalizeCondition,
  operandCount,
  opLabel,
  opsForKind,
  parseOptions,
} from "./descriptors";

const t = i18n.t.bind(i18n);

const field = (over: Partial<DescriptorField> = {}): DescriptorField => ({
  id: "f1",
  name: "Site",
  kind: "choice",
  options: ["North", "South"],
  sortOrder: 0,
  valueCount: 0,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("opsForKind", () => {
  it("offers contains for text but not for numbers", () => {
    expect(opsForKind("text")).toContain("contains");
    expect(opsForKind("number")).not.toContain("contains");
    expect(opsForKind("choice")).toContain("in");
    expect(opsForKind("date")).toContain("between");
  });

  it("always offers the emptiness operators", () => {
    for (const kind of ["text", "number", "choice", "date"] as const) {
      expect(opsForKind(kind)).toEqual(expect.arrayContaining(["empty", "notEmpty"]));
    }
  });
});

describe("opLabel", () => {
  it("reads gt/lt as more/less for numbers and after/before for dates", () => {
    expect(opLabel("gt", "number", t)).toBe("is more than");
    expect(opLabel("lt", "number", t)).toBe("is less than");
    expect(opLabel("gt", "date", t)).toBe("is after");
    expect(opLabel("eq", "text", t)).toBe("is");
  });
});

describe("operandCount", () => {
  it("counts operands per operator", () => {
    expect(operandCount("empty")).toBe(0);
    expect(operandCount("notEmpty")).toBe(0);
    expect(operandCount("between")).toBe(2);
    expect(operandCount("in")).toBe("many");
    expect(operandCount("eq")).toBe(1);
  });
});

describe("isConditionComplete", () => {
  it("needs as many operands as the operator takes", () => {
    expect(isConditionComplete({ fieldId: "f1", op: "empty", values: [] })).toBe(true);
    expect(isConditionComplete({ fieldId: "f1", op: "eq", values: [""] })).toBe(false);
    expect(isConditionComplete({ fieldId: "f1", op: "eq", values: ["North"] })).toBe(true);
    expect(isConditionComplete({ fieldId: "f1", op: "between", values: ["1"] })).toBe(false);
    expect(isConditionComplete({ fieldId: "f1", op: "between", values: ["1", " "] })).toBe(false);
    expect(isConditionComplete({ fieldId: "f1", op: "between", values: ["1", "9"] })).toBe(true);
    expect(isConditionComplete({ fieldId: "f1", op: "in", values: [] })).toBe(false);
    expect(isConditionComplete({ fieldId: "f1", op: "in", values: ["North"] })).toBe(true);
  });
});

describe("normalizeCondition", () => {
  it("trims, drops blanks and keeps only the operands the operator uses", () => {
    expect(normalizeCondition({ fieldId: "f1", op: "empty", values: ["x"] })).toEqual({
      fieldId: "f1",
      op: "empty",
      values: [],
    });
    expect(normalizeCondition({ fieldId: "f1", op: "eq", values: [" North ", "South"] })).toEqual({
      fieldId: "f1",
      op: "eq",
      values: ["North"],
    });
    expect(
      normalizeCondition({ fieldId: "f1", op: "in", values: ["North", "", " South "] }),
    ).toEqual({ fieldId: "f1", op: "in", values: ["North", "South"] });
  });
});

describe("defaultCondition", () => {
  it("picks the first operator for the kind and an empty operand slot", () => {
    expect(defaultCondition(field({ kind: "text" }))).toEqual({
      fieldId: "f1",
      op: "contains",
      values: [""],
    });
    expect(defaultCondition(field())).toEqual({ fieldId: "f1", op: "eq", values: [] });
  });
});

describe("describeCondition", () => {
  const fields = [field(), field({ id: "f2", name: "Age", kind: "number", options: [] })];

  it("reads as a sentence", () => {
    expect(
      describeCondition({ fieldId: "f1", op: "in", values: ["North", "South"] }, fields, t),
    ).toBe("Site is any of North, South");
    expect(describeCondition({ fieldId: "f1", op: "empty", values: [] }, fields, t)).toBe(
      "Site is empty",
    );
    expect(
      describeCondition({ fieldId: "f2", op: "between", values: ["18", "65"] }, fields, t),
    ).toBe("Age is between 18–65");
    expect(describeCondition({ fieldId: "f2", op: "gt", values: ["18"] }, fields, t)).toBe(
      "Age is more than 18",
    );
  });

  it("falls back when the field is gone", () => {
    expect(describeCondition({ fieldId: "gone", op: "eq", values: ["x"] }, fields, t)).toBe(
      "Descriptor is x",
    );
  });
});

describe("parseOptions", () => {
  it("splits lines, trims and drops blanks and case-insensitive duplicates", () => {
    expect(parseOptions("North\n  South  \n\nnorth\nEast")).toEqual(["North", "South", "East"]);
    expect(parseOptions("   ")).toEqual([]);
  });
});
