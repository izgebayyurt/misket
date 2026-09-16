import type { SetInfo } from "@/api/types";

/**
 * The "Sets" group at the top of a code or document picker: a set stands for
 * all of its members, exactly like ticking every one of them. Shared by the
 * excerpt browser's filters and the analysis views' document filter.
 */
export function SetsPickerGroup({
  sets,
  query,
  picked,
  onToggle,
}: {
  sets: SetInfo[] | undefined;
  query: string;
  picked: string[];
  onToggle: (id: string) => void;
}) {
  const shown = (sets ?? []).filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  if (shown.length === 0) return null;
  return (
    <>
      <p className="px-2 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
        Sets
      </p>
      {shown.map((s) => (
        <label
          key={s.id}
          className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
          data-testid="filter-set"
        >
          <input type="checkbox" checked={picked.includes(s.id)} onChange={() => onToggle(s.id)} />
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          <span className="text-xs tabular-nums text-fg-muted">{s.memberCount || ""}</span>
        </label>
      ))}
      <div className="my-1 h-px bg-border" />
    </>
  );
}
