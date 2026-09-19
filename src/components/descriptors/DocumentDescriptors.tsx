import { useState } from "react";
import { Settings2, Table } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useDescriptorFields, useDocumentDescriptorValues } from "@/queries/descriptors";
import { useWorkspace } from "@/state/workspace";
import { DescriptorsDialog } from "./DescriptorsDialog";
import { DescriptorValueInput } from "./DescriptorValueInput";

/** The document's attribute values, one input per field. */
export function DocumentDescriptors({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const { data: fields } = useDescriptorFields();
  const { data: values } = useDocumentDescriptorValues(documentId);
  const setView = useWorkspace((s) => s.setView);
  const [manage, setManage] = useState(false);

  return (
    <section className="border-b border-border p-3" data-testid="document-descriptors">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          {t("descriptors.title")}
        </h3>
        <div className="flex items-center">
          <button
            className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
            onClick={() => setView({ kind: "descriptorTable" })}
            title={t("descriptors.descriptorsTable")}
            aria-label={t("descriptors.descriptorsTable")}
          >
            <Table className="size-4" />
          </button>
          <button
            className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
            onClick={() => setManage(true)}
            title={t("descriptors.manageDescriptors")}
            aria-label={t("descriptors.manageDescriptors")}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </div>
      {fields && fields.length === 0 ? (
        <p className="mt-1 text-xs text-fg-muted">
          <Trans
            i18nKey="descriptors.noneYetHint"
            components={{
              btn: (
                <button
                  className="text-accent underline-offset-2 hover:underline"
                  onClick={() => setManage(true)}
                />
              ),
            }}
          />
        </p>
      ) : null}
      <div className="mt-2 space-y-2">
        {fields?.map((f) => {
          const value = values?.find((v) => v.fieldId === f.id)?.value ?? "";
          return (
            <div key={f.id}>
              <label className="text-xs font-medium text-fg-muted" htmlFor={`descriptor-${f.id}`}>
                {f.name}
              </label>
              <DescriptorValueInput
                // Keying on the stored value resets the draft when it changes
                // under us (an undo, or switching document).
                key={`${f.id}:${documentId}:${value}`}
                id={`descriptor-${f.id}`}
                documentId={documentId}
                field={f}
                value={value}
                className="mt-1"
              />
            </div>
          );
        })}
      </div>
      {manage ? <DescriptorsDialog onClose={() => setManage(false)} /> : null}
    </section>
  );
}
