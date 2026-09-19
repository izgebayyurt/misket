import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getDiagnostics } from "@/api/diagnostics";
import { toast } from "@/state/toasts";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
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
      toast.info(t("about.diagnosticsCopied"));
    } catch (e) {
      toast.error(e);
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Misket"
        description={version ? t("about.version", { version }) : undefined}
      >
        <p className="text-sm">{t("about.blurb")}</p>
        <p className="mt-2 text-sm text-fg-muted">{t("about.license")}</p>
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
          {copying ? t("about.copying") : t("about.copyDiagnostics")}
        </Button>
        <p className="mt-1 text-xs text-fg-muted">{t("about.copyHint")}</p>
      </DialogContent>
    </Dialog>
  );
}
