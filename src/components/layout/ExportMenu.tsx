import { save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "@/api/export";
import { exportRefi } from "@/api/refi";
import { currentLocale } from "@/lib/i18n";
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
  const { t } = useTranslation();
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
            ? { name: t("common.fileFilters.refiProject"), extensions: ["qdpx"] }
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
        const what = new Intl.ListFormat(currentLocale(), {
          type: "unit",
          style: "short",
        }).format([
          t("exportMenu.sources", { count: report.textSources + report.pictureSources }),
          t("exportMenu.codesCount", { count: report.codes }),
          t("exportMenu.codingsCount", { count: report.codings }),
        ]);
        toast.info(
          report.skipped.length > 0
            ? t("exportMenu.exportedLeftBehind", { what, skipped: report.skipped.join("; ") })
            : t("exportMenu.exportedTo", { what, name: path.split(/[\\/]/).pop() }),
        );
        return;
      } else await api.exportProjectJson(path);
      toast.info(t("exportMenu.exportedSuffixTo", { suffix, name: path.split(/[\\/]/).pop() }));
    } catch (e) {
      toast.error(e);
    }
  }

  async function runSaveCopy() {
    try {
      const path = await save({
        defaultPath: `${stem(project)}-copy.misket`,
        filters: [{ name: t("common.fileFilters.misketProject"), extensions: ["misket"] }],
      });
      if (!path) return;
      await saveCopy.mutateAsync(path);
      toast.info(t("exportMenu.savedCopyTo", { name: path.split(/[\\/]/).pop() }));
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 hover:text-fg" data-testid="export-menu">
          <Download className="size-3.5" /> {t("exportMenu.export")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuItem onSelect={() => run("codebook")}>
          {t("exportMenu.codebookCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("codebookJson")}>
          {t("exportMenu.codebookJson")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("excerpts")}>
          {t("exportMenu.excerptsCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("activity")}>
          {t("exportMenu.activityCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("project")}>
          {t("exportMenu.projectJson")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run("refi")} data-testid="export-refi">
          {t("exportMenu.refi")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void runSaveCopy()}>
          {t("exportMenu.saveCopyAs")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
