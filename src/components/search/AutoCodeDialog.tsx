import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { pathOf } from "@/core/codeTree";
import { buildOffsetMap, cpToUtf16, utf16ToCp } from "@/core/offsets";
import { paragraphAt, sentenceAt } from "@/core/textUnits";
import { getDocument } from "@/api/documents";
import type { AutoCodeHit, SearchHit } from "@/api/types";
import { useCodeTree } from "@/queries/codes";
import { useAutoCode } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

type Scope = "match" | "sentence" | "paragraph";

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "match", label: "Just the match", hint: "Code exactly what matched" },
  { value: "sentence", label: "The whole sentence", hint: "Expand each match to its sentence" },
  { value: "paragraph", label: "The whole paragraph", hint: "Expand each match to its paragraph" },
];

function dedupe(hits: AutoCodeHit[]): AutoCodeHit[] {
  const seen = new Set<string>();
  const out: AutoCodeHit[] = [];
  for (const h of hits) {
    const key = `${h.documentId}:${h.startPos}:${h.endPos}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/** Expand every hit to the chosen scope (fetching each distinct document's
 * text once) and drop duplicate ranges — several matches in the same
 * sentence or paragraph become one excerpt. */
async function computeRanges(hits: SearchHit[], scope: Scope): Promise<AutoCodeHit[]> {
  if (scope === "match") {
    return dedupe(
      hits.map((h) => ({ documentId: h.documentId, startPos: h.startPos, endPos: h.endPos })),
    );
  }
  const cache = new Map<string, { text: string; map: ReturnType<typeof buildOffsetMap> }>();
  const out: AutoCodeHit[] = [];
  for (const h of hits) {
    let entry = cache.get(h.documentId);
    if (!entry) {
      const doc = await getDocument(h.documentId);
      const text = doc.text ?? "";
      entry = { text, map: buildOffsetMap(text) };
      cache.set(h.documentId, entry);
    }
    const u16 = cpToUtf16(entry.map, h.startPos);
    const span = scope === "sentence" ? sentenceAt(entry.text, u16) : paragraphAt(entry.text, u16);
    out.push({
      documentId: h.documentId,
      startPos: utf16ToCp(entry.map, span.start),
      endPos: utf16ToCp(entry.map, span.end),
    });
  }
  return dedupe(out);
}

/**
 * "Auto-code all N matches…": pick a code, choose what to code (the match
 * itself, its sentence, or its paragraph), preview the count, then create
 * excerpts for every one in a single undoable step.
 */
export function AutoCodeDialog({ hits, onClose }: { hits: SearchHit[]; onClose: () => void }) {
  const tree = useCodeTree();
  const openCodePicker = useWorkspace((s) => s.openCodePicker);
  const autoCode = useAutoCode();
  const [codeId, setCodeId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("match");
  const [ranges, setRanges] = useState<AutoCodeHit[] | null>(null);
  const [computing, setComputing] = useState(true);
  const generation = useRef(0);

  const matches = `${hits.length} match${hits.length === 1 ? "" : "es"}`;

  // Reset for a new scope during render (React's recommended pattern for
  // resetting state in response to a prop/derived-value change), so the
  // "Working out the ranges…" message shows immediately rather than after an
  // extra commit; the effect below only owns kicking off (and reporting on)
  // the async computation itself.
  const [computedForScope, setComputedForScope] = useState<Scope | null>(null);
  if (computedForScope !== scope) {
    setComputedForScope(scope);
    setRanges(null);
    setComputing(true);
  }

  useEffect(() => {
    const gen = ++generation.current;
    computeRanges(hits, scope)
      .then((r) => {
        if (generation.current === gen) {
          setRanges(r);
          setComputing(false);
        }
      })
      .catch((e) => {
        if (generation.current === gen) {
          toast.error(e);
          setComputing(false);
        }
      });
    // `hits` is the fixed snapshot the dialog opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  function pickCode() {
    openCodePicker({
      label: `Auto-code ${matches}`,
      onPick: (id) => setCodeId(id),
    });
  }

  async function handleSubmit() {
    if (!codeId || !ranges || ranges.length === 0) return;
    const codeName = tree.byId.get(codeId)?.code.name ?? "this code";
    try {
      const report = await autoCode.mutateAsync({
        hits: ranges,
        codeId,
        label: `Auto-code ${matches} with ${codeName}`,
      });
      const parts: string[] = [];
      if (report.createdExcerptIds.length)
        parts.push(
          `${report.createdExcerptIds.length} new excerpt${report.createdExcerptIds.length === 1 ? "" : "s"}`,
        );
      if (report.reusedExcerptIds.length)
        parts.push(
          `${report.reusedExcerptIds.length} existing excerpt${report.reusedExcerptIds.length === 1 ? "" : "s"}`,
        );
      if (report.alreadyCoded) parts.push(`${report.alreadyCoded} already coded`);
      toast.info(`Coded ${parts.join(", ") || "nothing new"} with ${codeName}.`);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Auto-code ${matches}…`}
        description="Creates one excerpt per range (reusing any that already exist there) and tags it with the code you pick."
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Code</p>
            {codeId ? (
              <div className="flex items-center gap-2">
                <ColorDot color={tree.byId.get(codeId)?.code.color ?? "#999"} />
                <span className="flex-1 truncate text-sm">{pathOf(tree, codeId)}</span>
                <Button size="sm" variant="ghost" onClick={pickCode}>
                  Change…
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={pickCode} data-testid="autocode-pick">
                Choose a code…
              </Button>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Code what</p>
            <div className="space-y-1">
              {SCOPES.map((s) => (
                <label
                  key={s.value}
                  // The label's text lives two spans deep, past what
                  // eslint-plugin-jsx-a11y's static check can see; naming it
                  // explicitly also keeps the announced name to the scope's
                  // label, not the hint below it.
                  aria-label={s.label}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-1.5",
                    scope === s.value && "border-accent bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="autocode-scope"
                    className="mt-1"
                    checked={scope === s.value}
                    onChange={() => setScope(s.value)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-fg-muted">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <p className="text-xs text-fg-muted" data-testid="autocode-preview">
            {computing
              ? "Working out the ranges…"
              : ranges && ranges.length !== hits.length
                ? `This will create or reuse ${ranges.length} excerpt${ranges.length === 1 ? "" : "s"} for ${matches} (some share a ${scope}).`
                : `This will create or reuse an excerpt for each of ${matches}.`}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!codeId || computing || !ranges || ranges.length === 0 || autoCode.isPending}
            data-testid="autocode-submit"
          >
            Auto-code {ranges?.length ?? hits.length} match{hits.length === 1 ? "" : "es"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
