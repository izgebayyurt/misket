/**
 * Pure helpers for the inter-rater reliability view: how a kappa is named,
 * how the numbers are written down, and how a figure is coloured.
 *
 * The band boundaries are Landis & Koch (1977) and must stay in step with
 * `interpretation` in `crates/misket-core/src/db/irr.rs`, which is what the
 * CSV export writes.
 */

export type KappaBand = "none" | "poor" | "slight" | "fair" | "moderate" | "substantial" | "almost";

/**
 * A translator, so this module can hand back localized sentences without
 * importing react/i18next itself (src/core stays framework-free — see
 * CLAUDE.md). The caller passes `useTranslation()`'s `t`.
 */
export type IrrT = (key: string, params?: Record<string, unknown>) => string;

export interface Band {
  id: KappaBand;
  /** A translation key, not the label itself — resolved with `t()` where
   * it renders. */
  labelKey: string;
}

const BANDS: { max: number; id: KappaBand; labelKey: string }[] = [
  { max: 0, id: "poor", labelKey: "analysis.reliability.bandPoor" },
  { max: 0.2, id: "slight", labelKey: "analysis.reliability.bandSlight" },
  { max: 0.4, id: "fair", labelKey: "analysis.reliability.bandFair" },
  { max: 0.6, id: "moderate", labelKey: "analysis.reliability.bandModerate" },
  { max: 0.8, id: "substantial", labelKey: "analysis.reliability.bandSubstantial" },
  { max: 1, id: "almost", labelKey: "analysis.reliability.bandAlmostPerfect" },
];

/**
 * The Landis & Koch band for a kappa. A null kappa (undefined, not zero) has
 * no band: the view says so rather than pretending to a number.
 */
export function kappaBand(kappa: number | null | undefined): Band {
  if (kappa === null || kappa === undefined || Number.isNaN(kappa)) {
    return { id: "none", labelKey: "analysis.reliability.bandNone" };
  }
  if (kappa < 0) return { id: "poor", labelKey: "analysis.reliability.bandPoor" };
  const hit = BANDS.find((b) => b.max > 0 && kappa <= b.max) ?? BANDS[BANDS.length - 1]!;
  return { id: hit.id, labelKey: hit.labelKey };
}

/** Two decimals, or an em dash where kappa is undefined. */
export function formatKappa(kappa: number | null | undefined): string {
  if (kappa === null || kappa === undefined || Number.isNaN(kappa)) return "—";
  // -0.00 reads as a mistake; it is just a rounded zero.
  const rounded = Number(kappa.toFixed(2));
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

/** A 0..1 proportion as a whole-number percentage. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/**
 * Cell shading for a kappa, on the same accent-opacity scale the other
 * analysis matrices use: nothing below chance, deepening towards 1.
 */
export function kappaShade(kappa: number | null | undefined): {
  backgroundColor?: string;
  color?: string;
} {
  if (kappa === null || kappa === undefined || Number.isNaN(kappa) || kappa <= 0) return {};
  const t = Math.min(kappa, 1);
  const pct = Math.round(10 + 62 * t);
  return {
    backgroundColor: `color-mix(in srgb, var(--accent) ${pct}%, transparent)`,
    ...(pct >= 45 ? { color: "var(--accent-fg)" } : {}),
  };
}

/**
 * The sentence the summary strip and the methods section want: what was
 * compared, over what, and how much of it there was.
 */
export function describeScope(
  args: {
    unit: "paragraph" | "turn" | "excerpt";
    units: number;
    documents: number;
    codes: number;
  },
  t: IrrT,
): string {
  const unitKey =
    args.unit === "paragraph"
      ? "analysis.reliability.unitParagraph"
      : args.unit === "turn"
        ? "analysis.reliability.unitTurn"
        : "analysis.reliability.unitExcerpt";
  return t("analysis.reliability.scopeSentence", {
    units: t(unitKey, { count: args.units }),
    documents: t("excerpts.filters.documentCount", { count: args.documents }),
    codes: t("excerpts.filters.codeCount", { count: args.codes }),
  });
}
