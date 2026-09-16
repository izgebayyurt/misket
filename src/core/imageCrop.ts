/**
 * Geometry helpers for image documents.
 *
 * An image excerpt stores a rectangle as fractions of the image's width and
 * height (`{x,y,w,h}`, 0..1), so it survives any zoom level. These helpers
 * parse that rectangle and turn it into the CSS that shows just that part of
 * the image inside a fixed box — the thumbnails in the excerpt browser and
 * the inspector. Pure: no DOM, no React.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The whole image, used whenever a stored rectangle cannot be trusted. */
export const FULL_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };

function isFiniteRect(r: Rect): boolean {
  return [r.x, r.y, r.w, r.h].every((v) => typeof v === "number" && Number.isFinite(v));
}

/** Whether a rectangle is inside the image and has a positive area. */
export function isValidRect(r: Rect): boolean {
  return (
    isFiniteRect(r) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.w > 0 &&
    r.h > 0 &&
    r.x + r.w <= 1.000001 &&
    r.y + r.h <= 1.000001
  );
}

/** Parse an excerpt's `geometry` column; null when absent or malformed. */
export function parseGeometry(geometry: string | null | undefined): Rect | null {
  if (!geometry) return null;
  try {
    const v = JSON.parse(geometry) as Partial<Rect> | null;
    if (!v || typeof v !== "object") return null;
    const r = { x: Number(v.x), y: Number(v.y), w: Number(v.w), h: Number(v.h) };
    return isValidRect(r) ? r : null;
  } catch {
    return null;
  }
}

/** The rectangle between two points, in either drag direction, clamped to the image. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x1 = clamp(Math.min(ax, bx));
  const y1 = clamp(Math.min(ay, by));
  const x2 = clamp(Math.max(ax, bx));
  const y2 = clamp(Math.max(ay, by));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface CropStyle {
  /** The clipping box; the image inside it is absolutely positioned. */
  container: { width: string; height: string; overflow: "hidden"; position: "relative" };
  image: {
    position: "absolute";
    width: string;
    height: string;
    left: string;
    top: string;
    maxWidth: "none";
  };
}

const px = (v: number) => `${Math.round(v * 100) / 100}px`;

/**
 * CSS that shows only `region` of an image inside a `box`-sized element.
 *
 * With the image's `natural` size the crop keeps its aspect ratio and is
 * centred in the box (the usual thumbnail). Without it — before the image has
 * loaded — the crop is stretched to fill the box, which needs no measurement
 * and is replaced as soon as the size is known.
 */
export function cropStyle(region: Rect, box: Size, natural?: Size | null): CropStyle {
  const r = isValidRect(region) ? region : FULL_RECT;
  let width: number;
  let height: number;
  let left: number;
  let top: number;
  if (natural && natural.width > 0 && natural.height > 0) {
    const scale = Math.min(box.width / (r.w * natural.width), box.height / (r.h * natural.height));
    width = natural.width * scale;
    height = natural.height * scale;
    left = (box.width - r.w * width) / 2 - r.x * width;
    top = (box.height - r.h * height) / 2 - r.y * height;
  } else {
    width = box.width / r.w;
    height = box.height / r.h;
    left = -r.x * width;
    top = -r.y * height;
  }
  return {
    container: {
      width: px(box.width),
      height: px(box.height),
      overflow: "hidden",
      position: "relative",
    },
    image: {
      position: "absolute",
      width: px(width),
      height: px(height),
      left: px(left),
      top: px(top),
      maxWidth: "none",
    },
  };
}
