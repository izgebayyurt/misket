import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useCreateProject,
  useCreateSampleProject,
  useOpenProject,
  useRecentProjects,
  useRemoveRecent,
} from "@/queries/project";
import { toast } from "@/state/toasts";
import { isAppError } from "@/api/client";

const FILTER = [{ name: "Misket project", extensions: ["misket"] }];

export function StartScreen() {
  const recent = useRecentProjects();
  const openProject = useOpenProject();
  const createProject = useCreateProject();
  const createSample = useCreateSampleProject();
  const removeRecent = useRemoveRecent();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleOpen() {
    try {
      const path = await open({ multiple: false, directory: false, filters: FILTER });
      if (path) await openProject.mutateAsync(path);
    } catch (e) {
      toast.error(e);
    }
  }

  async function handleOpenRecent(path: string) {
    try {
      await openProject.mutateAsync(path);
    } catch (e) {
      if (isAppError(e, "NotFound")) {
        removeRecent.mutate(path);
        toast.info("That project file no longer exists; removed it from Recent.");
      } else {
        toast.error(e);
      }
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const path = await save({ defaultPath: `${name}.misket`, filters: FILTER });
      if (!path) return;
      const withExt = path.endsWith(".misket") ? path : `${path}.misket`;
      await createProject.mutateAsync({ path: withExt, name });
      setCreating(false);
      setNewName("");
    } catch (e) {
      toast.error(e);
    }
  }

  async function handleTrySample() {
    try {
      await createSample.mutateAsync();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-[560px] max-w-[90vw]">
        <div className="mb-8">
          <h1 className="font-serif text-4xl font-medium tracking-tight">Misket</h1>
          <p className="mt-1 text-fg-muted">Qualitative coding, on your own machine.</p>
        </div>

        <div className="mb-4 flex gap-2">
          <Button size="lg" onClick={() => setCreating(true)} data-testid="new-project">
            <Plus /> New project
          </Button>
          <Button size="lg" variant="outline" onClick={handleOpen} data-testid="open-project">
            <FolderOpen /> Open…
          </Button>
        </div>

        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={handleTrySample}
            disabled={createSample.isPending}
            data-testid="try-sample"
          >
            {createSample.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {createSample.isPending
              ? "Setting up the sample project…"
              : "Try Misket with sample data"}
          </Button>
        </div>

        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Recent</h2>
        {recent.data && recent.data.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border bg-panel">
            {recent.data.map((r) => (
              <li key={r.path} className="group flex items-center gap-3 px-3 py-2">
                <button
                  className="flex-1 truncate text-left hover:text-accent"
                  onClick={() => handleOpenRecent(r.path)}
                  title={r.path}
                >
                  <div className="font-medium">{r.name}</div>
                  <div className="truncate text-xs text-fg-muted">{r.path}</div>
                </button>
                <button
                  className="rounded p-1 text-fg-muted opacity-0 hover:bg-muted group-hover:opacity-100"
                  onClick={() => removeRecent.mutate(r.path)}
                  aria-label="Remove from recent"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">No recent projects yet.</p>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="New project"
          description="You will choose where to save the project file next."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <label className="text-xs font-medium text-fg-muted" htmlFor="project-name">
              Project name
            </label>
            <Input
              id="project-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Morning routines study"
              className="mt-1"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newName.trim() || createProject.isPending}>
                Choose location…
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
