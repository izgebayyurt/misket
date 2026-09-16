import type { SetKind } from "@/api/types";
import { useAddToSet, useSets } from "@/queries/sets";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/state/toasts";

/**
 * "Add to set ▸" for a code or document row's context menu. Hidden until at
 * least one set of that kind exists, so the menu stays short in small
 * projects.
 */
export function AddToSetMenu({
  kind,
  memberId,
  memberLabel,
}: {
  kind: SetKind;
  memberId: string;
  memberLabel: string;
}) {
  const { data: sets } = useSets(kind);
  const add = useAddToSet();
  if (!sets?.length) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="add-to-set">Add to set</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {sets.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={async () => {
              try {
                await add.mutateAsync({
                  setId: s.id,
                  memberId,
                  label: `Add "${memberLabel}" to "${s.name}"`,
                });
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-xs tabular-nums text-fg-muted">{s.memberCount || ""}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
