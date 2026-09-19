import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { useUpdateCheckOnMount } from "@/hooks/useUpdateCheck";

export function StartScreen() {
  const { t } = useTranslation();
  const recent = useRecentProjects();
  const openProject = useOpenProject();
  const createProject = useCreateProject();
  const createSample = useCreateSampleProject();
  const removeRecent = useRemoveRecent();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  useUpdateCheckOnMount();
  const filter = [{ name: t("common.fileFilters.misketProject"), extensions: ["misket"] }];

  async function handleOpen() {
    try {
      const path = await open({ multiple: false, directory: false, filters: filter });
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
        toast.info(t("startScreen.recentGone"));
      } else {
        toast.error(e);
      }
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const path = await save({ defaultPath: `${name}.misket`, filters: filter });
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
    <div className="flex h-full flex-col">
      <UpdateBanner />
      <div className="flex flex-1 items-center justify-center">
        <div className="w-[560px] max-w-[90vw]">
          <div className="mb-8">
            <h1 className="font-serif text-4xl font-medium tracking-tight">Misket</h1>
            <p className="mt-1 text-fg-muted">{t("startScreen.tagline")}</p>
          </div>

          <div className="mb-4 flex gap-2">
            <Button size="lg" onClick={() => setCreating(true)} data-testid="new-project">
              <Plus /> {t("startScreen.newProject")}
            </Button>
            <Button size="lg" variant="outline" onClick={handleOpen} data-testid="open-project">
              <FolderOpen /> {t("startScreen.openEllipsis")}
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
                ? t("startScreen.settingUpSample")
                : t("startScreen.trySample")}
            </Button>
          </div>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("startScreen.recent")}
          </h2>
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
                    aria-label={t("startScreen.removeFromRecent")}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">{t("startScreen.noRecent")}</p>
          )}
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title={t("startScreen.newProject")}
          description={t("startScreen.newProjectDescription")}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <label className="text-xs font-medium text-fg-muted" htmlFor="project-name">
              {t("startScreen.projectName")}
            </label>
            <Input
              id="project-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("startScreen.projectNamePlaceholder")}
              className="mt-1"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!newName.trim() || createProject.isPending}>
                {t("startScreen.chooseLocation")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
