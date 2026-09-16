import { useMemo } from "react";
import { useCodeTree } from "@/queries/codes";
import { flattenTree } from "@/core/codeTree";
import { useWorkspace } from "@/state/workspace";
import { SetsSection } from "@/components/sets/SetsSection";
import type { MemberOption } from "@/components/sets/SetDialog";

/** Code sets, listed under the code tree. Clicking one filters the browser. */
export function CodeSets() {
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const options = useMemo<MemberOption[]>(
    () =>
      flattenTree(tree).map((n) => ({
        id: n.code.id,
        label: n.code.name,
        depth: n.depth,
        color: n.code.color,
      })),
    [tree],
  );
  return (
    <SetsSection
      kind="code"
      title="Sets"
      options={options}
      onOpen={(s) => openExcerpts({ codeSetIds: [s.id] })}
    />
  );
}
