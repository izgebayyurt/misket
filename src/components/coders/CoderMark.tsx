import { initialsOf } from "@/core/coders";
import { useCoders } from "@/queries/coders";
import { FilterPicker } from "@/components/ui/filter-picker";
import { cn } from "@/lib/utils";
import type { CoderSummary } from "@/api/types";

/**
 * Who applied a coding: a small coloured disc with their initials, and their
 * name on hover. A `title` rather than a tooltip component, because these sit
 * in tight rows and a native tooltip never fights the popover above them.
 */
export function CoderMark({ coderId, className }: { coderId: string; className?: string }) {
  const { data: coders } = useCoders();
  const coder = coders?.find((c) => c.id === coderId);
  if (!coderId) return null;
  const name = coder?.name || coderId;
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 select-none items-center justify-center rounded-full " +
          "text-[8px] font-semibold leading-none text-white",
        className,
      )}
      style={{ background: coder?.color ?? "#6C757D" }}
      title={coder?.isLocal ? `${name} (you)` : name}
      data-testid="coder-mark"
      data-coder-id={coderId}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * The "Coders" filter chip: Everyone (nothing picked), Me, or any set of
 * coders. Shared by the excerpt browser and the analysis views, which all
 * mean the same thing by it — narrow to work done by these people.
 */
export function CoderFilter({
  coderIds,
  onChange,
  className,
}: {
  coderIds: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const { data: coders } = useCoders();
  const me = coders?.find((c) => c.isLocal);
  // One coder and it is you: there is nobody to tell apart, so no chip.
  if (!coders || coders.length < 2) return null;
  const picked = coders.filter((c) => coderIds.includes(c.id));
  const label =
    coderIds.length === 0
      ? "Everyone"
      : me && coderIds.length === 1 && coderIds[0] === me.id
        ? "Me"
        : picked.length === 1
          ? picked[0]!.name
          : `${coderIds.length} coders`;
  const toggle = (c: CoderSummary) =>
    onChange(coderIds.includes(c.id) ? coderIds.filter((x) => x !== c.id) : [...coderIds, c.id]);
  return (
    <span className={className}>
      <FilterPicker
        label={label}
        active={coderIds.length > 0}
        onClear={() => onChange([])}
        testId="filter-coders"
      >
        {(query) => (
          <>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
              onClick={() => onChange([])}
            >
              Everyone
            </button>
            {me ? (
              <button
                className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
                onClick={() => onChange([me.id])}
                data-testid="filter-coders-me"
              >
                Only me
              </button>
            ) : null}
            {coders
              .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
              .map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={coderIds.includes(c.id)}
                    onChange={() => toggle(c)}
                  />
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: c.color }}
                    aria-hidden
                  />
                  <span className="truncate">
                    {c.name}
                    {c.isLocal ? " (you)" : ""}
                  </span>
                  <span className="ml-auto text-xs text-fg-muted">{c.codingCount}</span>
                </label>
              ))}
          </>
        )}
      </FilterPicker>
    </span>
  );
}
