import { useEffect } from "react";
import { useSettings } from "@/state/settings";
import { useUpdates } from "@/state/updates";

/**
 * Checks for an update once per launch, the moment settings have loaded —
 * unless Settings' "Check for updates automatically" is off. Called from
 * both `StartScreen` and `Workspace` (only one is ever mounted at a time) so
 * the check fires whichever one is showing; `checkNow` itself no-ops, with a
 * console log, while the updater pubkey is still a placeholder (see
 * docs/RELEASING.md). Render `<UpdateBanner />` alongside this to show the
 * result.
 */
export function useUpdateCheckOnMount() {
  const settingsLoaded = useSettings((s) => s.loaded);
  const autoCheck = useSettings((s) => s.settings.checkForUpdatesAutomatically);
  const checkedThisSession = useUpdates((s) => s.checkedThisSession);
  const checkNow = useUpdates((s) => s.checkNow);
  useEffect(() => {
    if (!settingsLoaded || checkedThisSession || !autoCheck) return;
    void checkNow();
  }, [settingsLoaded, checkedThisSession, autoCheck, checkNow]);
}
