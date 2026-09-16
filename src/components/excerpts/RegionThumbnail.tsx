import { mediaUrl } from "@/api/media";
import { cropStyle, FULL_RECT, parseGeometry } from "@/core/imageCrop";
import { useDocuments } from "@/queries/documents";

interface Props {
  documentId: string;
  /** The excerpt's `geometry` column; the whole image when it cannot be read. */
  geometry: string | null;
  width: number;
  height: number;
}

/** The pixels an image excerpt covers, cropped into a fixed box. */
export function RegionThumbnail({ documentId, geometry, width, height }: Props) {
  const { data: docs } = useDocuments();
  const natural = docs?.find((d) => d.id === documentId)?.media ?? null;
  const { container, image } = cropStyle(
    parseGeometry(geometry) ?? FULL_RECT,
    { width, height },
    natural,
  );
  return (
    <div
      style={container}
      className="shrink-0 rounded border border-border bg-muted"
      data-testid="region-thumbnail"
    >
      <img src={mediaUrl(documentId)} alt="" draggable={false} style={image} />
    </div>
  );
}
