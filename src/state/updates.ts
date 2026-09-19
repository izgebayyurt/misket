import { create } from "zustand";
import { check as pluginCheck, Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import i18next from "@/lib/i18n";
import { e2eCheckUpdate, getE2eConfig } from "@/api/e2e";
import { getUpdaterStatus } from "@/api/updater";
import { shouldShowUpdateBanner } from "@/core/updates";
import { useSettings } from "@/state/settings";
import { toast } from "@/state/toasts";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing";

export interface UpdateInfo {
  version: string;
  notes: string | null;
}

export interface DownloadProgress {
  downloadedBytes: number;
  /** `null` until the server reports a content length (or never, for a
   * chunked response), in which case the banner shows bytes without a
   * percentage. */
  totalBytes: number | null;
}

interface UpdatesState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: DownloadProgress | null;
  /** Set after a failed download or install; cleared on the next check. */
  error: string | null;
  checkedThisSession: boolean;
  /** Look for an update. `announce` also reports "up to date" or a failure
   * with a toast — used for the explicit "Check for updates" action, as
   * opposed to the silent automatic check on launch. */
  checkNow: (opts?: { announce?: boolean }) => Promise<void>;
  installAndRestart: () => Promise<void>;
  /** Hide the banner without recording anything; it comes back on the next
   * check (next launch, or "Check for updates…" again). */
  later: () => void;
  /** Hide the banner and remember the version, so it stays quiet about this
   * exact release (Settings' "skippedUpdateVersion"). */
  skip: () => void;
}

/**
 * The live handle behind `info`: not plain data (its `download`/`install`
 * methods do the actual work), so it lives outside the store rather than as
 * state.
 */
let activeUpdate: Update | null = null;

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: "idle",
  info: null,
  progress: null,
  error: null,
  checkedThisSession: false,

  checkNow: async (opts) => {
    const announce = opts?.announce ?? false;
    if (get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", error: null, checkedThisSession: true });
    try {
      const e2e = await getE2eConfig().catch(() => null);
      let update: Update | null;
      if (e2e?.updateJsonUrl) {
        // Test-only: a local latest.json instead of the real GitHub
        // endpoint, so the banner can be exercised without a signed
        // release. A subsequent "Install and restart" will genuinely try
        // to download and verify it, which is expected to fail signature
        // verification (see docs/RELEASING.md and e2e/README.md).
        const metadata = await e2eCheckUpdate();
        update = metadata
          ? new Update({
              ...metadata,
              date: metadata.date ?? undefined,
              body: metadata.body ?? undefined,
            })
          : null;
      } else {
        const { configured } = await getUpdaterStatus();
        if (!configured) {
          console.log(
            "[updates] no-op: tauri.conf.json's updater pubkey is still the placeholder; see docs/RELEASING.md",
          );
          set({ status: "idle" });
          if (announce) {
            toast.info(i18next.t("updates.notConfigured"));
          }
          return;
        }
        update = await pluginCheck();
      }

      activeUpdate = update;
      const skippedVersion = useSettings.getState().settings.skippedUpdateVersion;
      const show =
        update !== null &&
        shouldShowUpdateBanner({
          currentVersion: update.currentVersion,
          latestVersion: update.version,
          skippedVersion,
        });

      if (!show || !update) {
        set({ status: "idle", info: null });
        if (announce) toast.info(i18next.t("updates.upToDate"));
        return;
      }
      set({
        status: "available",
        info: { version: update.version, notes: update.body ?? null },
      });
    } catch (e) {
      set({ status: "idle" });
      if (announce) toast.error(e);
      else console.warn("[updates] check failed:", e);
    }
  },

  installAndRestart: async () => {
    const update = activeUpdate;
    if (!update) return;
    set({ status: "downloading", progress: { downloadedBytes: 0, totalBytes: null }, error: null });
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          set({ progress: { downloadedBytes: 0, totalBytes: event.data.contentLength ?? null } });
        } else if (event.event === "Progress") {
          set((s) => ({
            progress: {
              downloadedBytes: (s.progress?.downloadedBytes ?? 0) + event.data.chunkLength,
              totalBytes: s.progress?.totalBytes ?? null,
            },
          }));
        }
      });
      set({ status: "installing" });
      await relaunch();
    } catch (e) {
      set({ status: "available", error: e instanceof Error ? e.message : String(e) });
      toast.error(e);
    }
  },

  later: () => set({ status: "idle" }),

  skip: () => {
    const version = get().info?.version;
    if (version) useSettings.getState().update({ skippedUpdateVersion: version });
    set({ status: "idle", info: null });
  },
}));
