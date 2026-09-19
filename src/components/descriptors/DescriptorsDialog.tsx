import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DescriptorField } from "@/api/types";
import { KIND_LABEL_KEYS } from "@/core/descriptors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  useCreateDescriptorField,
  useDeleteDescriptorField,
  useDescriptorFields,
  useReorderDescriptorFields,
  useUpdateDescriptorField,
} from "@/queries/descriptors";
import { toast } from "@/state/toasts";
import { DescriptorFieldForm } from "./DescriptorFieldForm";

/** Manage the project's document attributes: add, rename, reorder, delete. */
export function DescriptorsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data: fields } = useDescriptorFields();
  const create = useCreateDescriptorField();
  const update = useUpdateDescriptorField();
  const reorder = useReorderDescriptorFields();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DescriptorField | null>(null);
  const list = fields ?? [];

  async function move(index: number, delta: number) {
    const next = list.map((f) => f.id);
    const target = index + delta;
    const from = next[index];
    const to = next[target];
    if (from === undefined || to === undefined) return;
    next[index] = to;
    next[target] = from;
    try {
      await reorder.mutateAsync(next);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          title={t("descriptors.title")}
          description={t("descriptors.dialogDescription")}
          className="max-w-lg"
        >
          <div className="max-h-[50vh] space-y-1 overflow-y-auto" data-testid="descriptor-list">
            {list.length === 0 && !adding ? (
              <p className="py-2 text-sm text-fg-muted">{t("descriptors.dialogEmpty")}</p>
            ) : null}
            {list.map((f, i) =>
              editingId === f.id ? (
                <div key={f.id} className="rounded-md border border-border p-2">
                  <DescriptorFieldForm
                    field={f}
                    submitLabel={t("common.save")}
                    busy={update.isPending}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (v) => {
                      try {
                        await update.mutateAsync({
                          id: f.id,
                          patch: { name: v.name, kind: v.kind, options: v.options },
                        });
                        setEditingId(null);
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  />
                </div>
              ) : (
                <div
                  key={f.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  data-testid="descriptor-row"
                >
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-fg-muted">
                    {t(KIND_LABEL_KEYS[f.kind])}
                  </span>
                  {f.kind === "choice" ? (
                    <span className="truncate text-xs text-fg-muted">{f.options.join(", ")}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs text-fg-muted">
                    {f.valueCount || ""}
                  </span>
                  <button
                    className="rounded p-1 text-fg-muted hover:bg-border disabled:opacity-30"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={t("descriptors.moveUp", { name: f.name })}
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    className="rounded p-1 text-fg-muted hover:bg-border disabled:opacity-30"
                    onClick={() => move(i, 1)}
                    disabled={i === list.length - 1}
                    aria-label={t("descriptors.moveDown", { name: f.name })}
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    className="rounded p-1 text-fg-muted hover:bg-border"
                    onClick={() => {
                      setAdding(false);
                      setEditingId(f.id);
                    }}
                    aria-label={t("descriptors.editField", { name: f.name })}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    className="rounded p-1 text-fg-muted hover:bg-border hover:text-danger"
                    onClick={() => setDeleting(f)}
                    aria-label={t("descriptors.deleteField", { name: f.name })}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ),
            )}
          </div>
          {adding ? (
            <div className="mt-3 rounded-md border border-border p-2">
              <DescriptorFieldForm
                submitLabel={t("descriptors.add")}
                busy={create.isPending}
                onCancel={() => setAdding(false)}
                onSubmit={async (v) => {
                  try {
                    await create.mutateAsync({
                      name: v.name,
                      kind: v.kind,
                      options: v.kind === "choice" ? v.options : null,
                    });
                    setAdding(false);
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              />
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setEditingId(null);
                setAdding(true);
              }}
              data-testid="add-descriptor"
            >
              <Plus /> {t("descriptors.addDescriptor")}
            </Button>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {t("common.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {deleting ? (
        <DeleteDescriptorDialog field={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}

function DeleteDescriptorDialog({
  field,
  onClose,
}: {
  field: DescriptorField;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const del = useDeleteDescriptorField();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("descriptors.deleteDialogTitle", { name: field.name })}
        description={
          field.valueCount > 0
            ? t("descriptors.deleteDialogWillLose", { count: field.valueCount })
            : t("descriptors.deleteDialogNoneUse")
        }
      >
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending}
            data-testid="confirm-delete-descriptor"
            onClick={async () => {
              try {
                await del.mutateAsync(field.id);
                onClose();
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
