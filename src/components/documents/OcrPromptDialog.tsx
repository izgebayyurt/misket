import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useOcrPromptStore, type OcrDecision } from "@/state/ocrPrompt";
import type { ScannedPdfMessage } from "@/core/importers/pdfQuality";

/** `ScannedPdfMessage` as a sentence, in the active language. */
function formatScannedPdfMessage(
  m: ScannedPdfMessage,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  return m.kind === "emptyPages"
    ? t("documents.ocr.scannedEmptyPages", { emptyPages: m.emptyPages, totalPages: m.totalPages })
    : t("documents.ocr.scannedSparseText", {
        totalPages: m.totalPages,
        avgChars: m.avgCharsPerPage,
      });
}

/**
 * A promise-based prompt, one per scanned-looking PDF in the import batch
 * (see `useOcrPromptStore`). Mounted once near the app root, the same way
 * `TidyImportDialog` is.
 */
export function OcrPromptDialog() {
  const request = useOcrPromptStore((s) => s.request);
  if (!request) return null;
  return <OcrPromptDialogContent key={request.file.name} {...request} />;
}

function OcrPromptDialogContent({
  file,
  moreInBatch,
}: {
  file: { name: string; message: ScannedPdfMessage };
  moreInBatch: boolean;
}) {
  const { t } = useTranslation();
  const [applyToRest, setApplyToRest] = useState(false);
  const respond = useOcrPromptStore((s) => s.respond);

  const decide = (decision: OcrDecision) => respond({ decision, applyToRest });

  return (
    <Dialog open onOpenChange={(o) => !o && decide("skip")}>
      <DialogContent
        title={file.name}
        description={formatScannedPdfMessage(file.message, t)}
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">{t("documents.ocr.explain")}</p>
          {moreInBatch ? (
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={applyToRest}
                onChange={(e) => setApplyToRest(e.target.checked)}
                data-testid="ocr-apply-to-all"
              />
              {t("documents.ocr.applyToRest")}
            </label>
          ) : null}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={() => decide("skip")} data-testid="ocr-choice-skip">
            {t("documents.ocr.skip")}
          </Button>
          <Button variant="outline" onClick={() => decide("as-is")} data-testid="ocr-choice-as-is">
            {t("documents.ocr.importAsIs")}
          </Button>
          <Button onClick={() => decide("ocr")} data-testid="ocr-choice-ocr">
            {t("documents.ocr.recognise")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
