import { useDocument } from "@/queries/documents";
import { DocumentView } from "./DocumentView";
import { ImageView } from "./ImageView";
import { MediaView } from "./MediaView";

interface Props {
  documentId: string;
  focusExcerptId?: string;
  scrollToOffset?: number;
}

/**
 * Picks the viewer for the open document: text, an image with regions, or a
 * recording with a timeline. `kind === "video"` covers audio too — see
 * `documents::MEDIA_KIND` in the core crate.
 */
export function DocumentPane({ documentId, focusExcerptId, scrollToOffset }: Props) {
  const { data: doc, error } = useDocument(documentId);
  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;
  if (doc.kind === "image")
    return <ImageView documentId={documentId} focusExcerptId={focusExcerptId} />;
  if (doc.kind === "video")
    return (
      <MediaView
        documentId={documentId}
        focusExcerptId={focusExcerptId}
        // A media document has no text to scroll, so a caller that knows a
        // position in it means milliseconds — the history panel's "show me
        // where a deleted stretch was", for instance.
        seekToMs={scrollToOffset}
      />
    );
  return (
    <DocumentView
      documentId={documentId}
      focusExcerptId={focusExcerptId}
      scrollToOffset={scrollToOffset}
    />
  );
}
