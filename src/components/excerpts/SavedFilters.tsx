import { useMemo, useState } from "react";
import { Bookmark, ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExcerptFilter, SavedFilter } from "@/api/types";
import { useDeleteSavedFilter, useSaveFilter, useSavedFilters } from "@/queries/sets";
import { useCodeTree } from "@/queries/codes";
import { flattenTree } from "@/core/codeTree";
import { describeQuery } from "@/core/query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "@/state/toasts";

/**
 * The excerpt browser's "Saved filters" chip: save the filters as they stand
 * under a name, apply a saved one with a click, or delete it.
 */
export function SavedFilters({
  current,
  onApply,
}: {
  /** The filter as the browser has it right now. */
  current: ExcerptFilter;
  onApply: (filter: ExcerptFilter) => void;
}) {
  const { t } = useTranslation();
  const { data: saved } = useSavedFilters();
  const [naming, setNaming] = useState(false);
  const del = useDeleteSavedFilter();
  // A saved query is the one part of a filter a name rarely explains, so the
  // list spells it out under the name.
  const tree = useCodeTree();
  const codeName = useMemo(() => {
    const byId = new Map(flattenTree(tree).map((n) => [n.code.id, n.code.name]));
    return (id: string) => byId.get(id) ?? "";
  }, [tree]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted",
            )}
            data-testid="saved-filters"
          >
            <Bookmark className="size-3" /> {t("excerpts.savedFilters.saved")}{" "}
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => setNaming(true)} data-testid="save-filter">
            {t("excerpts.savedFilters.saveCurrent")}
          </DropdownMenuItem>
          {saved && saved.length > 0 ? <DropdownMenuSeparator /> : null}
          {saved?.map((f) => (
            <DropdownMenuItem
              key={f.id}
              onSelect={() => onApply(f.filter)}
              className="justify-between"
              data-testid="saved-filter-item"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{f.name}</span>
                {f.filter.query ? (
                  <span
                    className="block truncate text-xs text-fg-muted"
                    data-testid="saved-filter-query"
                  >
                    {describeQuery(f.filter.query, codeName, t)}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="rounded p-0.5 text-fg-muted hover:bg-border"
                aria-label={t("excerpts.savedFilters.deleteFilter", { name: f.name })}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await del.mutateAsync(f);
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                <X className="size-3" />
              </button>
            </DropdownMenuItem>
          ))}
          {saved && saved.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-fg-muted">{t("excerpts.savedFilters.empty")}</p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {naming ? (
        <NameDialog current={current} saved={saved ?? []} onClose={() => setNaming(false)} />
      ) : null}
    </>
  );
}

function NameDialog({
  current,
  saved,
  onClose,
}: {
  current: ExcerptFilter;
  saved: SavedFilter[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const save = useSaveFilter();
  const clash = saved.some((f) => f.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("excerpts.savedFilters.dialogTitle")}
        description={t("excerpts.savedFilters.dialogDescription")}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await save.mutateAsync({ name, filter: current });
              onClose();
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("excerpts.savedFilters.filterName")}
            aria-label={t("excerpts.savedFilters.filterName")}
            data-testid="saved-filter-name"
          />
          {clash ? (
            <p className="mt-1 text-xs text-fg-muted">
              {t("excerpts.savedFilters.replacesExisting")}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
