import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useCodes } from "@/queries/codes";
import { useExcerptQuery } from "@/queries/excerpts";
import { useCreateMemo } from "@/queries/memos";
import { MAX_EXCERPTS, assistedMemoFooter, summariseCodePrompt } from "@/core/assist/prompts";
import { TOAST_KEYS, toast } from "@/state/toasts";
import { useAssistDraft, useAssistEnabled } from "./useAssist";

/**
 * "Summarise excerpts…" for one code: a memo draft the researcher edits and
 * then saves, or throws away.
 *
 * The draft streams in, because it is prose and watching it arrive is how a
 * person decides early that it is going the wrong way and presses Stop. It is
 * a plain textarea from the first character: nothing is saved until Save, and
 * what is saved is whatever is in the box then, which may be nothing the
 * model wrote at all. The memo's own body carries a line saying it was
 * drafted with assistance, because a memo outlives the history log — it gets
 * exported, pasted into a paper, read years later.
 */
export function SummariseCodeButton({ codeId }: { codeId: string }) {
  const { t } = useTranslation();
  const enabled = useAssistEnabled("summariseCode");
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        data-testid="summarise-code"
        title={t("assist.summarise.buttonHint")}
      >
        <Sparkles className="size-3.5" /> {t("assist.summarise.button")}
      </Button>
      {open ? <SummariseCodeDialog codeId={codeId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SummariseCodeDialog({ codeId, onClose }: { codeId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: codes } = useCodes();
  const code = codes?.find((c) => c.id === codeId);
  const { data: page } = useExcerptQuery({
    codeIds: [codeId],
    includeDescendants: true,
    limit: MAX_EXCERPTS,
    offset: 0,
  });
  const draft = useAssistDraft("summariseCode", { stream: true });
  const createMemo = useCreateMemo();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !code || !page) return;
    started.current = true;
    if (page.rows.length === 0) return;
    void draft.run(
      summariseCodePrompt({
        codeName: code.name,
        codeDescription: code.description,
        excerpts: page.rows.map((r) => ({
          id: r.id,
          text: r.snapshot ?? "",
          documentName: r.documentName,
        })),
      }),
    );
    // Once, when the excerpts are in hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, page]);

  async function save() {
    const body = draft.text.trim();
    if (!body) return;
    try {
      await createMemo.mutateAsync({
        target: { codeId },
        title: t("assist.summarise.memoTitle", { name: code?.name ?? t("rightPanel.scope.code") }),
        body:
          body +
          (draft.assisted ? assistedMemoFooter(draft.assisted.provider, draft.assisted.model) : ""),
        assisted: draft.assisted,
      });
      onClose();
    } catch (e) {
      toast.error(e, { key: TOAST_KEYS.assist });
    }
  }

  const empty = page?.rows.length === 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("assist.summarise.title", { name: code?.name ?? t("assist.summarise.aCode") })}
        description={
          empty
            ? t("assist.summarise.noExcerpts")
            : t("assist.summarise.description", { count: page?.rows.length ?? 0 })
        }
        className="max-w-2xl"
      >
        {draft.error ? (
          <p className="mb-2 text-sm text-danger" data-testid="summarise-error">
            {draft.error}
          </p>
        ) : null}
        <Textarea
          rows={16}
          value={draft.text}
          onChange={(e) => draft.setText(e.target.value)}
          placeholder={draft.busy ? "" : t("assist.summarise.nothingDrafted")}
          className="font-mono text-[13px]"
          data-testid="summarise-body"
        />
        <p className="mt-1 text-[11px] text-fg-muted">{t("assist.summarise.citationHint")}</p>
        <DialogFooter>
          {draft.busy ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-fg-muted">
              <Loader2 className="size-3.5 animate-spin" /> {t("assist.drafting")}
            </span>
          ) : null}
          {draft.busy ? (
            <Button type="button" variant="outline" onClick={draft.cancel}>
              {t("assist.stop")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("assist.discard")}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={draft.busy || !draft.text.trim()}
            data-testid="summarise-save"
          >
            {t("assist.summarise.saveAsMemo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
