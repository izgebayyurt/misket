import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  currentIndex: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  matchWordForms: boolean;
  onMatchWordFormsChange: (v: boolean) => void;
}

/** A compact "find in document" bar docked at the top of the document view. */
export function FindBar({
  query,
  onQueryChange,
  currentIndex,
  total,
  onNext,
  onPrev,
  onClose,
  matchWordForms,
  onMatchWordFormsChange,
}: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className="flex items-center gap-1 border-b border-border bg-panel px-3 py-1.5"
      data-testid="find-bar"
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("documentView.findInDocument")}
        className="h-7 max-w-64 text-sm"
        data-testid="find-input"
      />
      <span className="w-16 shrink-0 text-center text-xs text-fg-muted" data-testid="find-count">
        {t("documentView.findCount", { current: total === 0 ? 0 : currentIndex + 1, total })}
      </span>
      <label
        className="flex shrink-0 items-center gap-1 px-1 text-xs text-fg-muted"
        title={t("documentView.matchWordFormsHint")}
      >
        <input
          type="checkbox"
          checked={matchWordForms}
          onChange={(e) => onMatchWordFormsChange(e.target.checked)}
          data-testid="find-match-word-forms"
        />
        {t("documentView.matchWordForms")}
      </label>
      <button
        type="button"
        className="rounded p-1 text-fg-muted hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={onPrev}
        disabled={total === 0}
        aria-label={t("documentView.previousMatch")}
        data-testid="find-prev"
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        className="rounded p-1 text-fg-muted hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={onNext}
        disabled={total === 0}
        aria-label={t("documentView.nextMatch")}
        data-testid="find-next"
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        className="ml-1 rounded p-1 text-fg-muted hover:bg-muted"
        onClick={onClose}
        aria-label={t("documentView.closeFindBar")}
        data-testid="find-close"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
