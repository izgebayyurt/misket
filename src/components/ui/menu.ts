import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from "react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./dropdown-menu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./context-menu";

/**
 * A row's actions are the same whether opened from its "…" button (a
 * `DropdownMenu`) or from right-clicking the row (a `ContextMenu`). Row menu
 * components take one of these bundles and render against it, so the two
 * triggers can never drift apart.
 */
export interface MenuPrimitives {
  Item: ComponentType<ComponentPropsWithoutRef<typeof DropdownMenuItem>>;
  Separator: ComponentType<ComponentPropsWithoutRef<typeof DropdownMenuSeparator>>;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<ComponentPropsWithoutRef<typeof DropdownMenuSubTrigger>>;
  SubContent: ComponentType<ComponentPropsWithoutRef<typeof DropdownMenuSubContent>>;
}

export const dropdownMenuPrimitives: MenuPrimitives = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export const contextMenuPrimitives: MenuPrimitives = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};
