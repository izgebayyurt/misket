import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdates } from "@/state/updates";

const RELEASES_URL = "https://github.com/izgebayyurt/misket/releases";

/**
 * Non-modal "an update is available" banner. Renders nothing until a check
 * (see `useUpdateCheckOnMount` in `@/hooks/useUpdateCheck`, called
 * alongside this from `StartScreen` and `Workspace`, or Settings' "Check for
 * updates…") finds a release newer than this one and not the one already
 * skipped.
 */
export function UpdateBanner() {
  const status = useUpdates((s) => s.status);
  const info = useUpdates((s) => s.info);
  const progress = useUpdates((s) => s.progress);
  const error = useUpdates((s) => s.error);
  const installAndRestart = useUpdates((s) => s.installAndRestart);
  const later = useUpdates((s) => s.later);
  const skip = useUpdates((s) => s.skip);

  if (status === "idle" || !info) return null;

  const downloading = status === "downloading" || status === "installing";
  const percent =
    progress?.totalBytes && progress.totalBytes > 0
      ? Math.round((progress.downloadedBytes / progress.totalBytes) * 100)
      : null;

  return (
    <div
      className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm"
      data-testid="update-banner"
    >
      <Download className="size-4 shrink-0 text-accent" aria-hidden />
      <p className="flex-1 leading-snug">
        Misket {info.version} is available
        {status === "installing" ? ": restarting…" : null}
        {status === "downloading"
          ? ` — downloading…${percent !== null ? ` ${percent}%` : ""}`
          : null}
        {error ? <span className="text-danger"> — {error}</span> : null}
      </p>
      <a
        href={`${RELEASES_URL}/tag/v${info.version}`}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap underline hover:text-fg"
      >
        Release notes
      </a>
      <Button
        size="sm"
        onClick={() => void installAndRestart()}
        disabled={downloading}
        data-testid="install-update"
      >
        {downloading ? <Loader2 className="size-4 animate-spin" /> : null}
        {status === "installing" ? "Restarting…" : "Install and restart"}
      </Button>
      <button
        className="whitespace-nowrap hover:text-fg"
        onClick={skip}
        disabled={downloading}
        data-testid="skip-update"
      >
        Skip this version
      </button>
      <button
        className="rounded p-1 text-fg-muted hover:bg-panel"
        onClick={later}
        aria-label="Later"
        disabled={downloading}
        data-testid="dismiss-update-banner"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
