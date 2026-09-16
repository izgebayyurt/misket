import { invoke } from "./client";
import type { BackupInfo, ProjectInfo } from "./types";

/** "Save a copy as…": write the open project to `path` without touching it. */
export const saveProjectCopy = (path: string) => invoke<void>("save_project_copy", { path });

/** Every backup next to the open project, newest first. */
export const listBackups = () => invoke<BackupInfo[]>("list_backups");

/** Replace the open project with one of its own backups (`path`). */
export const restoreBackup = (path: string) => invoke<ProjectInfo>("restore_backup", { path });
