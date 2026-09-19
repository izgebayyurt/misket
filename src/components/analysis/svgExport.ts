/**
 * Render an on-screen `<svg>` (the treemap or the dendrogram) to a PNG,
 * for `ExportPngButton`. DOM/canvas work, so this lives next to the
 * components rather than in `src/core`, which stays free of it.
 */
import i18next from "@/lib/i18n";

/** Rasterize `svg` to PNG bytes at `scale`× its rendered size, painting
 * `background` first so a transparent SVG doesn't turn black on export and
 * the file looks right regardless of the OS image viewer's own background. */
export async function svgToPng(
  svg: SVGSVGElement,
  background: string,
  scale = 2,
): Promise<Uint8Array> {
  const rect = svg.getBoundingClientRect();
  const viewBoxWidth = svg.viewBox.baseVal.width;
  const viewBoxHeight = svg.viewBox.baseVal.height;
  const width = Math.max(1, Math.round((rect.width || viewBoxWidth || 400) * scale));
  const height = Math.max(1, Math.round((rect.height || viewBoxHeight || 300) * scale));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(rect.width || viewBoxWidth));
  clone.setAttribute("height", String(rect.height || viewBoxHeight));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(i18next.t("analysis.exportRasterizeError")));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(i18next.t("analysis.exportCanvasError"));
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(i18next.t("analysis.exportEncodeError")))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The current theme's panel background, for `svgToPng`'s canvas fill. */
export function currentPanelBackground(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim();
  return value || "#ffffff";
}
