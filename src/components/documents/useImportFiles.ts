import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readSourceFile } from "@/api/project";
import { listDocuments } from "@/api/documents";
import { importFile, SUPPORTED_EXTENSIONS } from "@/core/importers";
import { useCreateDocument } from "@/queries/documents";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { isAppError } from "@/api/client";
import { useUndoStore } from "@/state/undoStore";

/** Import files by path: read bytes, parse, and create documents. */
export function useImportFiles() {
  const create = useCreateDocument();
  const openDocument = useWorkspace((s) => s.openDocument);

  const importPaths = useCallback(
    async (paths: string[]) => {
      let lastId: string | null = null;
      let imported = 0;
      const taken = new Set((await listDocuments()).map((d) => d.name));
      for (const path of paths) {
        try {
          const bytes = await readSourceFile(path);
          const parsed = await importFile(path, bytes);
          parsed.name = uniqueName(parsed.name, taken);
          taken.add(parsed.name);
          if (parsed.text.length > 2_000_000) {
            toast.info(`${parsed.name} is very large; the document view may be slow.`);
          }
          const doc = await create.mutateAsync({
            name: parsed.name,
            sourcePath: path,
            sourceFormat: parsed.sourceFormat,
            text: parsed.text,
          });
          lastId = doc.id;
          imported++;
        } catch (e) {
          if (isAppError(e, "Conflict")) {
            toast.info(
              `Skipped ${path.split(/[\\/]/).pop()}: identical document already imported.`,
            );
          } else {
            toast.error(e);
          }
        }
      }
      if (imported > 0) {
        useUndoStore.getState().clear();
        if (lastId) openDocument(lastId);
      }
    },
    [create, openDocument],
  );

  const pickAndImport = useCallback(async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "Documents", extensions: [...SUPPORTED_EXTENSIONS] }],
    });
    if (!picked) return;
    await importPaths(Array.isArray(picked) ? picked : [picked]);
  }, [importPaths]);

  return { importPaths, pickAndImport, isPending: create.isPending };
}

/** "name", then "name (2)", "name (3)"… until unused. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}
