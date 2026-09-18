import { useEffect, useRef } from "react";
import { getE2eConfig } from "@/api/e2e";
import { createProject, openProject } from "@/api/project";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";

/**
 * When launched with MISKET_E2E_PROJECT set, open (or create) that project and
 * import MISKET_E2E_IMPORT files so automated smoke tests never need a dialog.
 */
export function useE2eBootstrap(importPaths: (paths: string[]) => Promise<unknown>) {
  const qc = useQueryClient();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const cfg = await getE2eConfig();
        if (!cfg.projectPath) return;
        try {
          await openProject(cfg.projectPath);
        } catch {
          await createProject(cfg.projectPath, cfg.projectName ?? "E2E project");
        }
        useWorkspace.getState().reset();
        qc.resetQueries();
        if (cfg.importPaths.length) await importPaths(cfg.importPaths);
      } catch (e) {
        toast.error(e);
      }
    })();
  }, [qc, importPaths]);
}
