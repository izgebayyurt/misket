import { useDocument } from "@/queries/documents";
import { DocumentView } from "./DocumentView";
import { ImageView } from "./ImageView";

interface Props {
  documentId: string;
  focusExcerptId?: string;
  scrollToOffset?: number;
}

/** Picks the viewer for the open document: text, or an image with regions. */
export function DocumentPane({ documentId, focusExcerptId, scrollToOffset }: Props) {
  const { data: doc, error } = useDocument(documentId);
  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;
  if (doc.kind === "image")
    return <ImageView documentId={documentId} focusExcerptId={focusExcerptId} />;
  return (
    <DocumentView
      documentId={documentId}
      focusExcerptId={focusExcerptId}
      scrollToOffset={scrollToOffset}
    />
  );
}
