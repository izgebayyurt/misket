import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCodeHistory, useExcerptHistory } from "@/queries/activity";
import { absoluteTime, kindLabel, relativeTime } from "@/core/activity";
import { currentLocale } from "@/lib/i18n";
import { checkoutHistoryNode } from "@/queries/history";
import { toast } from "@/state/toasts";
import { Button } from "@/components/ui/button";
import type { ActivityEntry } from "@/api/types";

async function goToPoint(id: number) {
  try {
    await checkoutHistoryNode(id);
  } catch (e) {
    toast.error(e);
  }
}

/** One code's life in the codebook: the "living codebook" trail. */
export function CodeHistory({ codeId }: { codeId: string }) {
  const { t } = useTranslation();
  const { data } = useCodeHistory(codeId);
  return (
    <Timeline entries={data} empty={t("history.emptyForCode")} testId="code-history" />
  );
}

/** One excerpt's trail: coded, recoded, adjusted, split, merged. */
export function ExcerptHistory({ excerptId }: { excerptId: string }) {
  const { t } = useTranslation();
  const { data } = useExcerptHistory(excerptId);
  return (
    <Timeline entries={data} empty={t("history.emptyForExcerpt")} testId="excerpt-history" />
  );
}

/**
 * Oldest first, so it reads as a story rather than a feed, with a rule down
 * the left connecting the dots.
 *
 * `e.summary` and `kindLabel(e.kind)` are not translated — see the note in
 * `ActivityFeed.tsx` and `docs/DATA_MODEL.md` "Activity log language".
 */
function Timeline({
  entries,
  empty,
  testId,
}: {
  entries: ActivityEntry[] | undefined;
  empty: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();
  return (
    <div className="border-b border-border p-3" data-testid={testId}>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("keymap.history")}
      </h3>
      {!entries ? null : entries.length === 0 ? (
        <p className="text-xs text-fg-muted">{empty}</p>
      ) : (
        <ol className="ml-1 space-y-2 border-l border-border pl-3">
          {entries.map((e) => (
            <li key={e.id} className="group relative text-xs" data-testid="history-entry">
              <span
                className="absolute -left-[17px] top-1 size-1.5 rounded-full bg-border"
                aria-hidden
              />
              <div className="flex items-start justify-between gap-2">
                <div className="text-fg">{e.summary}</div>
                {e.isHead ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 shrink-0 px-1 text-[10px] opacity-0 group-hover:opacity-100"
                    title={t("history.goToPoint")}
                    onClick={() => void goToPoint(e.id)}
                    data-testid="history-go-to-point"
                  >
                    <MapPin className="size-3" /> {t("history.goToPoint")}
                  </Button>
                )}
              </div>
              <div className="text-fg-muted" title={absoluteTime(e.at, locale)}>
                {kindLabel(e.kind)} · {relativeTime(e.at, undefined, locale)}
                {e.actor ? ` · ${e.actor}` : ""}
              </div>
              <Changes entry={e} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The before/after pairs a `detail` payload carries, when it has any. */
function Changes({ entry }: { entry: ActivityEntry }) {
  const rows = Object.entries(entry.detail).flatMap(([field, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const pair = value as { from?: unknown; to?: unknown };
    if (!("from" in pair) || !("to" in pair)) return [];
    return [{ field, from: show(pair.from), to: show(pair.to) }];
  });
  if (rows.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5 text-[11px] text-fg-muted">
      {rows.map((r) => (
        <li key={r.field}>
          <span className="capitalize">{r.field}</span>: <del>{r.from}</del> → <span>{r.to}</span>
        </li>
      ))}
    </ul>
  );
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map(show).join(", ") || "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}
