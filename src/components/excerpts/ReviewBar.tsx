import { Check, Plus } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { Code } from "@/api/types";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/codebook/ColorSwatch";

interface Props {
  parent: Code;
  /** The parent's direct children, in codebook order. */
  childCodes: Code[];
  /** How many of the parent's own excerpts are still in the list. */
  remaining: number;
  /** Whether a row is selected, i.e. whether the child buttons do anything. */
  hasTarget: boolean;
  busy: boolean;
  onPushDown: (childId: string) => void;
  onNewChild: () => void;
  onDone: () => void;
}

/**
 * Push-down review: the excerpt browser shows a parent code's *own* excerpts
 * and this bar stays pinned above them, so re-filing one is a single press
 * rather than a trip through the palette. The first nine children get a
 * number key; the rest are still one click.
 */
export function ReviewBar({
  parent,
  childCodes,
  remaining,
  hasTarget,
  busy,
  onPushDown,
  onNewChild,
  onDone,
}: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel px-3 py-2"
      data-testid="review-bar"
    >
      <span className="mr-1 text-sm">
        <Trans
          i18nKey="excerpts.reviewing"
          values={{ name: parent.name }}
          components={{ b: <span className="font-medium" /> }}
        />
        <span className="ml-1.5 tabular-nums text-fg-muted">
          {t("excerpts.reviewingLeft", { count: remaining })}
        </span>
      </span>
      {childCodes.length === 0 ? (
        <span className="text-sm text-fg-muted">{t("excerpts.reviewNoChildren")}</span>
      ) : (
        childCodes.map((c, i) => (
          <Button
            key={c.id}
            size="sm"
            variant="outline"
            disabled={busy || !hasTarget}
            onClick={() => onPushDown(c.id)}
            title={
              hasTarget
                ? t("excerpts.reviewMoveTo", { name: c.name })
                : t("excerpts.reviewSelectFirst")
            }
            data-testid="review-child"
          >
            <ColorDot color={c.color} />
            <span className="max-w-40 truncate">{c.name}</span>
            {i < 9 ? (
              <kbd className="rounded border border-border px-1 font-mono text-[10px] text-fg-muted">
                {i + 1}
              </kbd>
            ) : null}
          </Button>
        ))
      )}
      <Button size="sm" variant="ghost" onClick={onNewChild} disabled={busy}>
        <Plus /> {t("excerpts.reviewNewChild")}
      </Button>
      <span className="flex-1" />
      <Button size="sm" variant="outline" onClick={onDone}>
        <Check /> {t("common.done")}
      </Button>
    </div>
  );
}
