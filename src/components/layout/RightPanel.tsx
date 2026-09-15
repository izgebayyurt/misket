import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/state/workspace";
import { ExcerptInspector } from "@/components/excerpts/ExcerptInspector";
import { MemoList } from "@/components/memos/MemoList";
import { useDocuments } from "@/queries/documents";
import { useCodeTree } from "@/queries/codes";
import { pathOf } from "@/core/codeTree";
import { cn } from "@/lib/utils";
import { useShortcutActions } from "@/state/shortcutActions";
import { useCreateMemo } from "@/queries/memos";
import { toast } from "@/state/toasts";
import type { MemoTarget } from "@/api/types";

type Scope = "document" | "code" | "project";

/** Context panel: the focused excerpt, or memos for the document/code/project. */
export function RightPanel() {
  const focusedId = useWorkspace((s) => s.focusedExcerptId);
  const view = useWorkspace((s) => s.view);
  const selectedCodeId = useWorkspace((s) => s.selectedCodeId);
  const sidebarTab = useWorkspace((s) => s.sidebarTab);
  const { data: docs } = useDocuments();
  const tree = useCodeTree();
  const create = useCreateMemo();
  const documentId = view.kind === "document" ? view.documentId : null;

  // The panel follows the sidebar (a selected code shows its memos, an open
  // document shows its memos); the scope tabs override that until the
  // sidebar context changes again.
  const autoScope: Scope =
    sidebarTab === "codes" && selectedCodeId ? "code" : documentId ? "document" : "project";
  const contextKey = `${sidebarTab}:${selectedCodeId ?? ""}:${documentId ?? ""}`;
  const [override, setOverride] = useState<{ key: string; scope: Scope } | null>(null);
  const chosen = override?.key === contextKey ? override.scope : autoScope;
  const effectiveScope: Scope =
    chosen === "document" && !documentId
      ? "project"
      : chosen === "code" && !selectedCodeId
        ? "project"
        : chosen;
  const setScope = (scope: Scope) => setOverride({ key: contextKey, scope });

  const target = useMemo<MemoTarget>(
    () =>
      focusedId
        ? { excerptId: focusedId }
        : effectiveScope === "document" && documentId
          ? { documentId }
          : effectiveScope === "code" && selectedCodeId
            ? { codeId: selectedCodeId }
            : {},
    [focusedId, effectiveScope, documentId, selectedCodeId],
  );

  useEffect(() => {
    return useShortcutActions.getState().register({
      newMemo: () => {
        create.mutateAsync({ target }).catch(toast.error);
      },
    });
  }, [target, create]);

  return (
    <aside
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel"
      data-testid="right-panel"
    >
      {focusedId ? (
        <ExcerptInspector excerptId={focusedId} />
      ) : (
        <>
          <div className="flex border-b border-border text-xs">
            {(["document", "code", "project"] as const).map((s) => (
              <button
                key={s}
                className={cn(
                  "flex-1 py-1.5 capitalize text-fg-muted hover:text-fg disabled:opacity-40",
                  effectiveScope === s && "border-b-2 border-accent font-medium text-fg",
                )}
                disabled={(s === "document" && !documentId) || (s === "code" && !selectedCodeId)}
                onClick={() => setScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <MemoList
            target={target}
            heading={
              effectiveScope === "document"
                ? (docs?.find((d) => d.id === documentId)?.name ?? "Document")
                : effectiveScope === "code"
                  ? pathOf(tree, selectedCodeId ?? "") || "Code"
                  : "Project memos"
            }
          />
        </>
      )}
    </aside>
  );
}
