import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { useCodes, useCodeTree } from "@/queries/codes";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { Button } from "@/components/ui/button";
import { MAX_CODEBOOK_CODES, trimCodebook, type CodebookEntry } from "@/core/assist/codebook";
import { suggestCodesPrompt } from "@/core/assist/prompts";
import { parseSuggestions, type CodeSuggestion } from "@/core/assist/suggestions";
import type { AssistedRef } from "@/api/types";
import { useAssistDraft } from "./useAssist";

interface Props {
  /** The selected passage itself. */
  passage: string;
  contextBefore: string;
  contextAfter: string;
  /** Apply an existing code. Nothing happens until this is called. */
  onApply: (codeId: string, assisted: AssistedRef) => void;
  /** Open the new-code dialog prefilled with this name. */
  onNewCode: (name: string, assisted: AssistedRef) => void;
  onClose: () => void;
}

/**
 * Suggested codes for one passage, as chips nobody has accepted.
 *
 * Every chip is a button and nothing else: no code is applied, no code is
 * created, nothing is saved until the person clicks one. A chip for an
 * existing code goes through the ordinary `apply_codes` path, so undo, coder
 * identity and weight defaults work exactly as they do for a code applied
 * from the palette; a chip for a code that does not exist yet opens the code
 * dialog with the name filled in, and the person still has to press Create.
 */
export function SuggestCodes({
  passage,
  contextBefore,
  contextAfter,
  onApply,
  onNewCode,
  onClose,
}: Props) {
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const draft = useAssistDraft("suggestCodes");
  const [suggestions, setSuggestions] = useState<CodeSuggestion[] | null>(null);

  const codebook = useMemo<CodebookEntry[]>(
    () =>
      (codes ?? []).map((c) => ({
        id: c.id,
        path: pathOf(tree, c.id) || c.name,
        description: c.description,
        inclusion: c.inclusion,
        exclusion: c.exclusion,
      })),
    [codes, tree],
  );

  // One request per passage, when the panel opens.
  useEffect(() => {
    if (!codes) return;
    let cancelled = false;
    const sent = trimCodebook(codebook, passage, MAX_CODEBOOK_CODES);
    const prompt = suggestCodesPrompt({
      passage,
      contextBefore,
      contextAfter,
      codebook: sent,
      codebookTotal: codebook.length,
    });
    void draft.run(prompt).then((reply) => {
      if (cancelled || !reply) return;
      setSuggestions(parseSuggestions(reply.text, new Set(codebook.map((c) => c.id))));
    });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the passage alone: editing the codebook in
    // another window should not silently spend another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passage, codes !== undefined]);

  return (
    <div className="rounded-md border border-border bg-panel p-2" data-testid="suggest-codes">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-accent" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Suggestions
        </span>
        {draft.busy ? (
          <Button size="sm" variant="ghost" onClick={draft.cancel}>
            Stop
          </Button>
        ) : null}
        <button
          type="button"
          className="rounded p-0.5 text-fg-muted hover:bg-muted"
          aria-label="Close suggestions"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {draft.busy ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Loader2 className="size-3.5 animate-spin" /> Asking…
        </p>
      ) : null}
      {draft.error ? (
        <p className="text-xs text-danger" data-testid="suggest-codes-error">
          {draft.error}
        </p>
      ) : null}
      {!draft.busy && !draft.error && suggestions?.length === 0 ? (
        <p className="text-xs text-fg-muted">Nothing suggested for this passage.</p>
      ) : null}

      <ul className="flex flex-wrap gap-1">
        {(suggestions ?? []).map((s) => (
          <li key={s.codeId ?? `new:${s.newCodeName}`}>
            <button
              type="button"
              data-testid="suggestion-chip"
              title={`${s.rationale || "No reason given."}\nConfidence ${Math.round(s.confidence * 100)}%`}
              className="flex items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-xs hover:border-accent hover:bg-muted"
              onClick={() => {
                if (!draft.assisted) return;
                if (s.codeId) onApply(s.codeId, draft.assisted);
                else if (s.newCodeName) onNewCode(s.newCodeName, draft.assisted);
              }}
            >
              {s.codeId ? (
                <ColorDot color={tree.byId.get(s.codeId)?.code.color ?? "#999"} />
              ) : (
                <span className="text-accent">+</span>
              )}
              <span className="max-w-44 truncate">
                {s.codeId ? pathOf(tree, s.codeId) : s.newCodeName}
              </span>
              <span className="tabular-nums text-fg-muted">{Math.round(s.confidence * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>

      {suggestions && suggestions.length > 0 ? (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          Hover for the reason. Clicking applies the code as your own coding; nothing is applied
          until you click.
        </p>
      ) : null}
    </div>
  );
}
