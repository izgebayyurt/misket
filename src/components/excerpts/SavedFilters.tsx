import { useState } from "react";
import { Bookmark, ChevronDown, X } from "lucide-react";
import type { ExcerptFilter, SavedFilter } from "@/api/types";
import { useDeleteSavedFilter, useSaveFilter, useSavedFilters } from "@/queries/sets";
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
  const { data: saved } = useSavedFilters();
  const [naming, setNaming] = useState(false);
  const del = useDeleteSavedFilter();

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
            <Bookmark className="size-3" /> Saved <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => setNaming(true)} data-testid="save-filter">
            Save current filter…
          </DropdownMenuItem>
          {saved && saved.length > 0 ? <DropdownMenuSeparator /> : null}
          {saved?.map((f) => (
            <DropdownMenuItem
              key={f.id}
              onSelect={() => onApply(f.filter)}
              className="justify-between"
              data-testid="saved-filter-item"
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button
                type="button"
                className="rounded p-0.5 text-fg-muted hover:bg-border"
                aria-label={`Delete saved filter "${f.name}"`}
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
            <p className="px-2 py-1.5 text-xs text-fg-muted">
              Nothing saved yet. Set the filters you use often, then save them here.
            </p>
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
  const [name, setName] = useState("");
  const save = useSaveFilter();
  const clash = saved.some((f) => f.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Save filter"
        description="Stores the code, document, set, descriptor and uncoded settings as they are now."
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
            placeholder="Filter name"
            aria-label="Filter name"
            data-testid="saved-filter-name"
          />
          {clash ? (
            <p className="mt-1 text-xs text-fg-muted">Replaces the filter saved under this name.</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
