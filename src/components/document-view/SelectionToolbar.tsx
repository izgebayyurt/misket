import { Sparkles, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { describe } from "@/core/keymap";

interface Props {
  pos: { top: number; left: number };
  onCode: () => void;
  /**
   * Ask for code suggestions for this selection. Absent when assistance is
   * switched off, which is the default — then the button simply is not there.
   */
  onSuggest?: () => void;
}

/** A small floating action anchored below the end of the current selection. */
export function SelectionToolbar({ pos, onCode, onSuggest }: Props) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("documentView.selectionActions")}
      className="absolute z-20 flex items-center gap-1 rounded-md border border-border bg-panel p-0.5 shadow-md"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
      data-testid="selection-toolbar"
    >
      <button
        type="button"
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-muted"
        onClick={onCode}
      >
        <Tag className="size-3.5" /> {t("documentView.code")}
        <kbd className="ml-1 text-fg-muted">{describe("palette")}</kbd>
      </button>
      {onSuggest ? (
        <button
          type="button"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-muted"
          onClick={onSuggest}
          title={t("excerpts.suggestHint")}
          data-testid="selection-suggest"
        >
          <Sparkles className="size-3.5" /> {t("excerpts.suggest")}
        </button>
      ) : null}
    </div>
  );
}
