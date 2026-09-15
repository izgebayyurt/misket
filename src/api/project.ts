import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { invoke } from "./client";
import type { ProjectInfo, RecentProject } from "./types";

export const createProject = (path: string, name: string) =>
  invoke<ProjectInfo>("create_project", { path, name });
export const openProject = (path: string) => invoke<ProjectInfo>("open_project", { path });
export const closeProject = () => invoke<void>("close_project");
export const getProjectInfo = () => invoke<ProjectInfo | null>("get_project_info");
export const listRecentProjects = () => invoke<RecentProject[]>("list_recent_projects");
export const removeRecentProject = (path: string) =>
  invoke<void>("remove_recent_project", { path });

/** Raw bytes of a file on disk (for importers). */
export async function readSourceFile(path: string): Promise<Uint8Array> {
  const buf = await tauriInvoke<ArrayBuffer>("read_source_file", { path });
  return new Uint8Array(buf);
}
