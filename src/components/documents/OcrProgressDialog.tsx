import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useOcrProgressStore } from "@/state/ocrProgress";

/** A modal progress dialog for the OCR pass on one PDF: "page x of N", with
 * a cancel button. Mounted once near the app root. */
export function OcrProgressDialog() {
  const { t } = useTranslation();
  const run = useOcrProgressStore((s) => s.run);
  if (!run) return null;

  const pct = run.pages > 0 ? Math.round((run.page / run.pages) * 100) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && run.cancel()}>
      <DialogContent
        title={t("documents.ocr.recognisingTitle")}
        description={run.name}
        className="max-w-sm"
      >
        <div className="space-y-2">
          <p className="text-sm text-fg-muted" data-testid="ocr-progress-label">
            {run.pages > 0
              ? t("documents.ocr.pageOf", { page: run.page, pages: run.pages })
              : t("documents.ocr.starting")}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={run.cancel} data-testid="ocr-cancel">
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
