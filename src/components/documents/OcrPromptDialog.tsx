import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useOcrPromptStore, type OcrDecision } from "@/state/ocrPrompt";

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
  file: { name: string; message: string };
  moreInBatch: boolean;
}) {
  const [applyToRest, setApplyToRest] = useState(false);
  const respond = useOcrPromptStore((s) => s.respond);

  const decide = (decision: OcrDecision) => respond({ decision, applyToRest });

  return (
    <Dialog open onOpenChange={(o) => !o && decide("skip")}>
      <DialogContent title={file.name} description={file.message} className="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Recognising text renders each page as an image and reads it with on-device OCR — no
            internet connection needed, but it takes a while for long documents.
          </p>
          {moreInBatch ? (
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={applyToRest}
                onChange={(e) => setApplyToRest(e.target.checked)}
                data-testid="ocr-apply-to-all"
              />
              Apply to the rest of this import
            </label>
          ) : null}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={() => decide("skip")} data-testid="ocr-choice-skip">
            Skip
          </Button>
          <Button variant="outline" onClick={() => decide("as-is")} data-testid="ocr-choice-as-is">
            Import what was found
          </Button>
          <Button onClick={() => decide("ocr")} data-testid="ocr-choice-ocr">
            Recognise text (OCR)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
