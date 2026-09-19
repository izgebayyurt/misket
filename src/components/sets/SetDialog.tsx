import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetInfo, SetKind } from "@/api/types";
import { useCreateSet, useSetMembers, useSetSetMembers } from "@/queries/sets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/state/toasts";

/** One candidate member, in the order (and at the depth) it is displayed. */
export interface MemberOption {
  id: string;
  label: string;
  /** Indentation level; codes carry their tree depth, documents are flat. */
  depth?: number;
  /** Rendered as a colour dot before the label, for codes. */
  color?: string;
}

/**
 * "New set…" (a name and a checklist of candidates) and "Edit members…" (the
 * same checklist for an existing set). Renaming happens inline in the row.
 */
export function SetDialog({
  kind,
  set,
  options,
  onClose,
  onCreated,
}: {
  kind: SetKind;
  /** Absent for a new set. */
  set?: SetInfo;
  options: MemberOption[];
  onClose: () => void;
  onCreated?: (set: SetInfo) => void;
}) {
  const { data: current } = useSetMembers(set?.id ?? null);
  return set && !current ? null : (
    <Form
      kind={kind}
      set={set}
      options={options}
      initialMembers={current ?? []}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

function Form({
  kind,
  set,
  options,
  initialMembers,
  onClose,
  onCreated,
}: {
  kind: SetKind;
  set?: SetInfo;
  options: MemberOption[];
  initialMembers: string[];
  onClose: () => void;
  onCreated?: (set: SetInfo) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(set?.name ?? "");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialMembers));
  const [query, setQuery] = useState("");
  const create = useCreateSet();
  const replace = useSetSetMembers();
  const isCode = kind === "code";
  const shown = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // The checklist is shown in display order, so store it that way too.
    const memberIds = options.filter((o) => picked.has(o.id)).map((o) => o.id);
    try {
      if (set) {
        await replace.mutateAsync({ setId: set.id, memberIds, setName: set.name });
      } else {
        const created = await create.mutateAsync({ kind, name, memberIds });
        if (created) onCreated?.(created);
      }
      onClose();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={
          set
            ? t("sets.membersOf", { name: set.name })
            : t(isCode ? "sets.newCodeSet" : "sets.newDocumentSet")
        }
        description={
          set
            ? undefined
            : t(isCode ? "sets.newCodeSetDescription" : "sets.newDocumentSetDescription")
        }
      >
        <form onSubmit={submit}>
          {set ? null : (
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("sets.setName")}
              aria-label={t("sets.setName")}
              data-testid="set-name"
            />
          )}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(isCode ? "sets.filterCodes" : "sets.filterDocuments")}
            aria-label={t(isCode ? "sets.filterCodes" : "sets.filterDocuments")}
            className="mt-2 h-7 text-xs"
          />
          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border p-1">
            {shown.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-fg-muted">
                {t(isCode ? "sets.noCodesToChoose" : "sets.noDocumentsToChoose")}
              </p>
            ) : (
              shown.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                  style={{ paddingLeft: 8 + (query ? 0 : (o.depth ?? 0)) * 12 }}
                >
                  <input type="checkbox" checked={picked.has(o.id)} onChange={() => toggle(o.id)} />
                  {o.color ? (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: o.color }}
                    />
                  ) : null}
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            {t(isCode ? "sets.selectedCodeCount" : "sets.selectedDocumentCount", {
              count: picked.size,
            })}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!set && !name.trim()} data-testid="save-set">
              {set ? t("common.save") : t("sets.createSet")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
