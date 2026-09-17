import { save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import * as api from "@/api/export";
import { exportRefi } from "@/api/refi";
import { useSaveProjectCopy } from "@/queries/backup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/state/toasts";
import type { ProjectInfo } from "@/api/types";

function stem(project: ProjectInfo) {
  return project.name.replace(/[^\w.-]+/g, "_") || "misket";
}

export function ExportMenu({ project }: { project: ProjectInfo }) {
  const saveCopy = useSaveProjectCopy();

  async function run(
    kind: "codebook" | "codebookJson" | "excerpts" | "project" | "activity" | "refi",
  ) {
    const ext =
      kind === "refi" ? "qdpx" : kind === "codebookJson" || kind === "project" ? "json" : "csv";
    const suffix = kind === "codebookJson" ? "codebook" : kind === "refi" ? "refi-qda" : kind;
    try {
      const path = await save({
        defaultPath: `${stem(project)}-${suffix}.${ext}`,
        filters: [
          kind === "refi"
            ? { name: "REFI-QDA project", extensions: ["qdpx"] }
            : { name: ext.toUpperCase(), extensions: [ext] },
        ],
      });
      if (!path) return;
      if (kind === "codebook") await api.exportCodebookCsv(path);
      else if (kind === "codebookJson") await api.exportCodebookJson(path);
      else if (kind === "excerpts") await api.exportExcerptsCsv(path, {});
      else if (kind === "activity") await api.exportActivityCsv(path);
      else if (kind === "refi") {
        const report = await exportRefi(path);
        const what = [
          `${report.textSources + report.pictureSources} sources`,
          `${report.codes} codes`,
          `${report.codings} codings`,
        ].join(", ");
        toast.info(
          report.skipped.length > 0
            ? `Exported ${what}; left behind: ${report.skipped.join("; ")}`
            : `Exported ${what} to ${path.split(/[\\/]/).pop()}`,
        );
        return;
      } else await api.exportProjectJson(path);
      toast.info(`Exported ${suffix} to ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast.error(e);
    }
  }

  async function runSaveCopy() {
    try {
      const path = await save({
        defaultPath: `${stem(project)}-copy.misket`,
        filters: [{ name: "Misket project", extensions: ["misket"] }],
      });
      if (!path) return;
      await saveCopy.mutateAsync(path);
      toast.info(`Saved a copy to ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 hover:text-fg" data-testid="export-menu">
          <Download className="size-3.5" /> Export
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuItem onSelect={() => run("codebook")}>Codebook (CSV)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("codebookJson")}>
          Codebook (JSON, reusable)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("excerpts")}>All excerpts (CSV)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("activity")}>Activity log (CSV)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("project")}>Whole project (JSON)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run("refi")} data-testid="export-refi">
          REFI-QDA (.qdpx)…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void runSaveCopy()}>Save a copy as…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
