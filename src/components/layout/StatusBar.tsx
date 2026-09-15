import type { ProjectInfo } from "@/api/types";
import { useCloseProject } from "@/queries/project";
import { useUndoStore } from "@/state/undoStore";

export function StatusBar({ project }: { project: ProjectInfo }) {
  const close = useCloseProject();
  const lastLabel = useUndoStore((s) => s.past[s.past.length - 1]?.label);
  return (
    <footer className="flex h-7 items-center gap-4 border-t border-border bg-panel px-3 text-xs text-fg-muted">
      <span>
        {project.counts.documents} documents · {project.counts.codes} codes ·{" "}
        {project.counts.excerpts} excerpts
      </span>
      {lastLabel ? <span className="truncate">Last: {lastLabel}</span> : null}
      <span className="flex-1" />
      <button className="hover:text-fg" onClick={() => close.mutate()}>
        Close project
      </button>
    </footer>
  );
}
