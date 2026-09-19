import { useTranslation } from "react-i18next";
import type { SetKind } from "@/api/types";
import { useAddToSet, useSets } from "@/queries/sets";
import { dropdownMenuPrimitives, type MenuPrimitives } from "@/components/ui/menu";
import { toast } from "@/state/toasts";

/**
 * "Add to set ▸" for a code or document row's menu. Hidden until at least
 * one set of that kind exists, so the menu stays short in small projects.
 * `menu` picks the button-triggered `DropdownMenu` or the right-click
 * `ContextMenu` primitives so both triggers render the same submenu.
 */
export function AddToSetMenu({
  kind,
  memberId,
  memberLabel,
  menu = dropdownMenuPrimitives,
}: {
  kind: SetKind;
  memberId: string;
  memberLabel: string;
  menu?: MenuPrimitives;
}) {
  const { t } = useTranslation();
  const { data: sets } = useSets(kind);
  const add = useAddToSet();
  const { Item, Sub, SubContent, SubTrigger } = menu;
  if (!sets?.length) return null;
  return (
    <Sub>
      <SubTrigger data-testid="add-to-set">{t("sets.addToSet")}</SubTrigger>
      <SubContent>
        {sets.map((s) => (
          <Item
            key={s.id}
            onSelect={async () => {
              try {
                await add.mutateAsync({
                  setId: s.id,
                  memberId,
                  label: t("sets.addMemberToSetLabel", { member: memberLabel, set: s.name }),
                });
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-xs tabular-nums text-fg-muted">{s.memberCount || ""}</span>
          </Item>
        ))}
      </SubContent>
    </Sub>
  );
}
