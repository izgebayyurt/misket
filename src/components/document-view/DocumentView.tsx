import { useDocument } from "@/queries/documents";

export function DocumentView({ documentId }: { documentId: string; focusExcerptId?: string }) {
  const { data: doc, error } = useDocument(documentId);
  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;
  const text = doc.text ?? "";
  const paragraphs = splitParagraphs(text);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-10 py-10">
        <h1 className="mb-6 font-serif text-2xl font-medium">{doc.name}</h1>
        <div className="doc-text" data-testid="doc-text">
          {paragraphs.map(({ start, text: p }) => (
            <p key={start} data-p={start}>
              {p.length === 0 ? <br /> : <span data-s={start}>{p}</span>}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function splitParagraphs(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = 0;
  for (const p of text.split("\n")) {
    out.push({ start, text: p });
    start += p.length + 1;
  }
  return out;
}
