import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

const SCOPES: { value: Scope; labelKey: string; hintKey: string }[] = [
  {
    value: "match",
    labelKey: "search.autoCode.scopeMatchLabel",
    hintKey: "search.autoCode.scopeMatchHint",
  },
  {
    value: "sentence",
    labelKey: "search.autoCode.scopeSentenceLabel",
    hintKey: "search.autoCode.scopeSentenceHint",
  },
  {
    value: "paragraph",
    labelKey: "search.autoCode.scopeParagraphLabel",
    hintKey: "search.autoCode.scopeParagraphHint",
  },
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
  const { t } = useTranslation();
  const tree = useCodeTree();
  const openCodePicker = useWorkspace((s) => s.openCodePicker);
  const autoCode = useAutoCode();
  const [codeId, setCodeId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("match");
  const [ranges, setRanges] = useState<AutoCodeHit[] | null>(null);
  const [computing, setComputing] = useState(true);
  const generation = useRef(0);

  const matches = t("search.matchCount", { count: hits.length });

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
      label: t("search.autoCode.pickCodeLabel", { matches }),
      onPick: (id) => setCodeId(id),
    });
  }

  async function handleSubmit() {
    if (!codeId || !ranges || ranges.length === 0) return;
    const codeName = tree.byId.get(codeId)?.code.name ?? t("search.autoCode.thisCodeFallback");
    try {
      const report = await autoCode.mutateAsync({
        hits: ranges,
        codeId,
        label: t("search.autoCode.historyLabel", { matches, codeName }),
      });
      const parts: string[] = [];
      if (report.createdExcerptIds.length)
        parts.push(t("search.autoCode.newExcerpts", { count: report.createdExcerptIds.length }));
      if (report.reusedExcerptIds.length)
        parts.push(
          t("search.autoCode.existingExcerpts", { count: report.reusedExcerptIds.length }),
        );
      if (report.alreadyCoded)
        parts.push(t("search.autoCode.alreadyCoded", { count: report.alreadyCoded }));
      toast.info(
        t("search.autoCode.toastCoded", {
          what: parts.join(", ") || t("search.autoCode.nothingNew"),
          codeName,
        }),
      );
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("search.autoCode.title", { matches })}
        description={t("search.autoCode.description")}
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">
              {t("search.autoCode.codeLabel")}
            </p>
            {codeId ? (
              <div className="flex items-center gap-2">
                <ColorDot color={tree.byId.get(codeId)?.code.color ?? "#999"} />
                <span className="flex-1 truncate text-sm">{pathOf(tree, codeId)}</span>
                <Button size="sm" variant="ghost" onClick={pickCode}>
                  {t("search.autoCode.changeEllipsis")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={pickCode} data-testid="autocode-pick">
                {t("search.autoCode.chooseACodeEllipsis")}
              </Button>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">
              {t("search.autoCode.codeWhatLabel")}
            </p>
            <div className="space-y-1">
              {SCOPES.map((s) => (
                <label
                  key={s.value}
                  // The label's text lives two spans deep, past what
                  // eslint-plugin-jsx-a11y's static check can see; naming it
                  // explicitly also keeps the announced name to the scope's
                  // label, not the hint below it.
                  aria-label={t(s.labelKey)}
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
                    <span className="block text-sm font-medium">{t(s.labelKey)}</span>
                    <span className="block text-xs text-fg-muted">{t(s.hintKey)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <p className="text-xs text-fg-muted" data-testid="autocode-preview">
            {computing
              ? t("search.autoCode.workingOutRanges")
              : ranges && ranges.length !== hits.length
                ? t("search.autoCode.previewShared", {
                    count: ranges.length,
                    matches,
                    scope: t(`search.autoCode.scopeNoun.${scope}`),
                  })
                : t("search.autoCode.previewEachOf", { matches })}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!codeId || computing || !ranges || ranges.length === 0 || autoCode.isPending}
            data-testid="autocode-submit"
          >
            {t("search.autoCode.submitButton", { count: ranges?.length ?? hits.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Every `search.autoCode.scopeNoun.*` key built at runtime
 * (`` `search.autoCode.scopeNoun.${scope}` `` in the preview text above),
 * written out literally and never called: `scripts/i18n-extract.mjs` only
 * finds string literals, so this keeps them checked as "used" instead of
 * reading as dead. Keep in sync with `Scope`.
 */
function _scopeNounKeysForExtraction(t: (key: string) => string) {
  t("search.autoCode.scopeNoun.match");
  t("search.autoCode.scopeNoun.sentence");
  t("search.autoCode.scopeNoun.paragraph");
}
void _scopeNounKeysForExtraction;
