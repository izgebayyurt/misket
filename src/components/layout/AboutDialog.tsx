import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getDiagnostics } from "@/api/diagnostics";
import { toast } from "@/state/toasts";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string>("");
  const [build, setBuild] = useState<{ os: string; webview: string } | null>(null);
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("dev"));
    getDiagnostics()
      .then((d) => setBuild({ os: d.os, webview: d.webview }))
      .catch(() => setBuild(null));
  }, []);

  async function copyDiagnostics() {
    setCopying(true);
    try {
      const d = await getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
      toast.info("Diagnostics copied");
    } catch (e) {
      toast.error(e);
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Misket" description={version ? `Version ${version}` : undefined}>
        <p className="text-sm">
          Open-source qualitative coding, on your own machine. Your project is a single SQLite file;
          nothing leaves your computer.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          MIT licensed. Source and issues: github.com/izgebayyurt/misket
        </p>
        {build ? (
          <p className="mt-2 font-mono text-xs text-fg-muted">
            {build.os} · webview {build.webview}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void copyDiagnostics()}
          disabled={copying}
        >
          {copying ? "Copying…" : "Copy diagnostics"}
        </Button>
        <p className="mt-1 text-xs text-fg-muted">
          Copies the app version, OS, webview and the last 50 log lines (redacted the same way an
          opt-in crash report would be) — never document text, codes, memos or file names.
        </p>
      </DialogContent>
    </Dialog>
  );
}
