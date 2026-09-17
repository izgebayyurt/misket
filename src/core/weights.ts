import type { WeightScale } from "@/api/types";

/**
 * Pure helpers for a code's weight scale: snapping a value onto it,
 * checking whether it fits, formatting it for display, and looking up a
 * label. Mirrors `crates/misket-core/src/db/codes.rs`
 * (`validate_weight_scale`, `snap_weight`, `fits_weight_scale`); the Rust
 * side is the one that actually enforces these when a weight is stored; this
 * module lets the UI show the same answer before a round trip to the
 * backend confirms it.
 */

/** `min < max`, `step > 0`, `default` within `[min, max]`. */
export function validateWeightScale(scale: WeightScale): string | null {
  if (!(scale.min < scale.max)) {
    return `min (${scale.min}) must be less than max (${scale.max})`;
  }
  if (!(scale.step > 0)) {
    return `step (${scale.step}) must be greater than zero`;
  }
  if (scale.default < scale.min || scale.default > scale.max) {
    return `default (${scale.default}) must be between ${scale.min} and ${scale.max}`;
  }
  return null;
}

/**
 * Snap `value` to the nearest step of `scale`, then clamp to `[min, max]`
 * (clamping after snapping so a value just past an end lands on the end
 * rather than one step beyond it).
 */
export function snapWeight(scale: WeightScale, value: number): number {
  const steps = Math.round((value - scale.min) / scale.step);
  const snapped = scale.min + steps * scale.step;
  return Math.min(scale.max, Math.max(scale.min, snapped));
}

/** Whether `value` falls inside `scale`'s range, so carrying it over (a
 * retag, a merge) needs no snapping and loses nothing. */
export function fitsWeightScale(scale: WeightScale, value: number): boolean {
  return value >= scale.min && value <= scale.max;
}

/** Every value a scale can take, in order — only sound for a scale whose
 * range divides evenly by its step, which is the common case (1..5 by 1,
 * -2..2 by 1); a scale with a fractional step still works for display, it
 * just may not include every rounding of every intermediate value. */
export function weightScaleValues(scale: WeightScale): number[] {
  const out: number[] = [];
  const count = Math.round((scale.max - scale.min) / scale.step);
  for (let i = 0; i <= count; i++) {
    out.push(snapWeight(scale, scale.min + i * scale.step));
  }
  return out;
}

/** The key `labels` is stored under for a value: the same formatting the
 * value itself displays with, so `1` and `1.0` are not two different keys. */
export function weightLabelKey(value: number): string {
  return formatWeight(value);
}

/** A scale's label for one value, or `null` if it has none. */
export function weightLabel(scale: WeightScale, value: number): string | null {
  return scale.labels?.[weightLabelKey(value)] ?? null;
}

/** A weight for display: as few decimals as the value needs, never more than
 * the scale's `step` would ever produce. */
export function formatWeight(value: number): string {
  // Round to 6 decimals first so floating-point noise (3.0000000000000004)
  // never forces extra digits.
  return String(Math.round(value * 1e6) / 1e6);
}

/** A value's label if the scale has one, else its plain formatted number. */
export function formatWeightWithLabel(scale: WeightScale, value: number): string {
  const label = weightLabel(scale, value);
  return label ? `${formatWeight(value)} (${label})` : formatWeight(value);
}
