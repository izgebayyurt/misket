import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExcerptQuery } from "@/queries/excerpts";
import {
  MAX_EXCERPTS,
  MIN_EXCERPTS_FOR_DEFINITION,
  draftDefinitionPrompt,
} from "@/core/assist/prompts";
import { parseDefinition, type DefinitionDraft } from "@/core/assist/suggestions";
import type { AssistedRef } from "@/api/types";
import { useAssistDraft, useAssistEnabled } from "./useAssist";

interface Props {
  codeId: string;
  codeName: string;
  /** Fill the dialog's fields. Nothing is saved: the dialog's Save does that. */
  onDraft: (draft: DefinitionDraft, assisted: AssistedRef) => void;
}

/**
 * "Draft definition" in the code dialog.
 *
 * Only offered for a code with at least three excerpts: below that there is
 * nothing to generalise from and a draft would be the model's prior about the
 * code's *name*, which is exactly the kind of quiet wrong answer researchers
 * object to. The drafted fields land in the form still editable, and nothing
 * reaches the project until the dialog's own Save.
 */
export function DraftDefinitionButton({ codeId, codeName, onDraft }: Props) {
  const enabled = useAssistEnabled("suggestDefinition");
  const { data: page } = useExcerptQuery({
    codeIds: [codeId],
    includeDescendants: false,
    limit: MAX_EXCERPTS,
    offset: 0,
  });
  const draft = useAssistDraft("suggestDefinition", { stream: true });

  if (!enabled) return null;
  const count = page?.total ?? 0;
  const tooFew = count < MIN_EXCERPTS_FOR_DEFINITION;

  async function go() {
    if (!page) return;
    const reply = await draft.run(
      draftDefinitionPrompt({
        codeName,
        excerpts: page.rows.map((r) => ({
          id: r.id,
          text: r.snapshot ?? "",
          documentName: r.documentName,
        })),
      }),
    );
    if (!reply) return;
    const parsed = parseDefinition(reply.text);
    if (parsed) onDraft(parsed, { provider: reply.provider, model: reply.model });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={tooFew || draft.busy}
        onClick={() => void go()}
        data-testid="draft-definition"
        title={
          tooFew
            ? `Needs at least ${MIN_EXCERPTS_FOR_DEFINITION} excerpts to draft from (this code has ${count}).`
            : `Draft from this code's ${count} excerpts. Nothing is saved until you press Save.`
        }
      >
        {draft.busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Sparkles className="size-3.5" />
        )}
        Draft definition
      </Button>
      {draft.busy ? (
        <button type="button" className="text-xs text-fg-muted underline" onClick={draft.cancel}>
          Stop
        </button>
      ) : null}
      {tooFew ? (
        <span className="text-[11px] text-fg-muted">
          Needs {MIN_EXCERPTS_FOR_DEFINITION} excerpts ({count} so far).
        </span>
      ) : null}
      {draft.error ? (
        <span className="text-[11px] text-danger" data-testid="draft-definition-error">
          {draft.error}
        </span>
      ) : null}
    </div>
  );
}
