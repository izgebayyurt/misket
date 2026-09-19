import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCodes } from "@/queries/codes";
import { useExcerptDetail } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";

/**
 * The selected code's definition in the right-hand panel: what it means, when
 * to apply it, when not to, and the excerpt someone pinned as the canonical
 * instance. The palette deliberately shows only the description while coding;
 * this is where the whole thing is readable.
 */
export function CodeDefinition({ codeId }: { codeId: string }) {
  const { t } = useTranslation();
  const { data: codes } = useCodes();
  const code = codes?.find((c) => c.id === codeId);
  const { data: example } = useExcerptDetail(code?.exampleExcerptId ?? null);
  const openDocument = useWorkspace((s) => s.openDocument);

  if (!code) return null;
  const empty = !code.description && !code.inclusion && !code.exclusion && !code.exampleExcerptId;
  if (empty) return null;

  return (
    <section className="border-b border-border p-3" data-testid="code-definition">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("codebook.definition.title")}
      </h3>
      <dl className="space-y-1.5 text-sm">
        {code.description ? (
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-muted">
              {t("codebook.definition.means")}
            </dt>
            <dd className="whitespace-pre-wrap">{code.description}</dd>
          </div>
        ) : null}
        {code.inclusion ? (
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-muted">
              {t("codebook.dialog.inclusionLabel")}
            </dt>
            <dd className="whitespace-pre-wrap">{code.inclusion}</dd>
          </div>
        ) : null}
        {code.exclusion ? (
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-muted">
              {t("codebook.dialog.exclusionLabel")}
            </dt>
            <dd className="whitespace-pre-wrap">{code.exclusion}</dd>
          </div>
        ) : null}
      </dl>
      {code.exampleExcerptId ? (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-fg-muted">
            <Star className="size-3 fill-current text-accent" /> {t("codebook.definition.example")}
          </p>
          {example ? (
            <button
              type="button"
              className="mt-0.5 w-full rounded border-l-2 border-accent bg-muted/60 px-2 py-1 text-left hover:bg-muted"
              onClick={() => openDocument(example.documentId, example.id)}
              title={t("codebook.definition.openExcerptHint")}
            >
              <span className="block font-serif text-[13px] leading-snug">{example.snapshot}</span>
              <span className="mt-0.5 block text-[11px] text-fg-muted">{example.documentName}</span>
            </button>
          ) : (
            <p className="mt-0.5 text-[13px] text-fg-muted">{t("common.loading")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
