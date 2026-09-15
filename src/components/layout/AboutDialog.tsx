import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("dev"));
  }, []);
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
      </DialogContent>
    </Dialog>
  );
}
