/**
 * Pure geometry for the excerpts-per-day sparkline: turns a series of
 * non-negative counts into SVG path data. No DOM, no chart library.
 */

export interface SparklineOptions {
  width: number;
  height: number;
}

export interface SparklinePoint {
  x: number;
  y: number;
}

/**
 * Evenly spaced points across `width`×`height`. The tallest value in
 * `values` touches `y = 0`; every other value scales relative to it, so an
 * all-zero series draws flat along the baseline (`y = height`) instead of
 * dividing by zero. A single value sits centered on the x-axis.
 */
export function sparklinePoints(
  values: number[],
  { width, height }: SparklineOptions,
): SparklinePoint[] {
  if (values.length === 0) return [];
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: values.length > 1 ? i * step : width / 2,
    y: height - (Math.max(0, v) / max) * height,
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

/** An SVG `<path d>` tracing the sparkline's line, or `""` for no data. */
export function sparklineLinePath(values: number[], options: SparklineOptions): string {
  const points = sparklinePoints(values, options);
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)},${round(p.y)}`).join(" ");
}

/**
 * An SVG `<path d>` for the area under the line, closed along the baseline
 * so it can be filled. `""` for no data.
 */
export function sparklineAreaPath(values: number[], options: SparklineOptions): string {
  const points = sparklinePoints(values, options);
  if (points.length === 0) return "";
  const line = sparklineLinePath(values, options);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${line} L${round(last.x)},${round(options.height)} L${round(first.x)},${round(options.height)} Z`;
}
