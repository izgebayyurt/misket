import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCodes, useSetCodeExample } from "@/queries/codes";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

/**
 * Pin one excerpt as a code's canonical example, from wherever that excerpt's
 * codes are listed (the document popover, the right-hand inspector). It sits
 * on the code row rather than on the excerpt as a whole, because an excerpt
 * usually carries several codes and only one of them is being illustrated.
 *
 * Pressing it again clears the example, so the star is a toggle; both
 * directions are one undoable command.
 */
export function UseAsExampleButton({
  codeId,
  excerptId,
  className,
}: {
  codeId: string;
  excerptId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data: codes } = useCodes();
  const setExample = useSetCodeExample();
  const code = codes?.find((c) => c.id === codeId);
  const isExample = code?.exampleExcerptId === excerptId;
  const name = code?.name ?? t("documentView.defaultCodeName");

  return (
    <button
      type="button"
      className={cn(
        "rounded p-0.5 text-fg-muted hover:bg-border",
        isExample ? "text-accent opacity-100" : "opacity-0 group-hover:opacity-100",
        className,
      )}
      title={
        isExample
          ? t("codebook.useAsExample.clearHint", { name })
          : t("codebook.useAsExample.useHint", { name })
      }
      aria-label={
        isExample
          ? t("codebook.useAsExample.clearAria", { name })
          : t("codebook.useAsExample.useAria", { name })
      }
      aria-pressed={isExample}
      disabled={setExample.isPending}
      onClick={() =>
        setExample
          .mutateAsync({ codeId, excerptId: isExample ? null : excerptId })
          .catch(toast.error)
      }
      data-testid="use-as-example"
    >
      <Star className={cn("size-3.5", isExample && "fill-current")} />
    </button>
  );
}
