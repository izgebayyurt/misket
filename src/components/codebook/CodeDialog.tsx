import { useState } from "react";
import type { Code } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { ColorPicker } from "./ColorSwatch";
import { useCodes, useCreateCode, useUpdateCode } from "@/queries/codes";
import { nextColor, pathOf } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import { toast } from "@/state/toasts";

type Props =
  | {
      mode: "create";
      parentId: string | null;
      onClose: () => void;
      onCreated?: (code: Code) => void;
    }
  | { mode: "edit"; code: Code; onClose: () => void };

export function CodeDialog(props: Props) {
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const create = useCreateCode();
  const update = useUpdateCode();
  const editing = props.mode === "edit" ? props.code : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? nextColor(codes ?? []));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [inclusion, setInclusion] = useState(editing?.inclusion ?? "");
  const [exclusion, setExclusion] = useState(editing?.exclusion ?? "");
  const [shortcut, setShortcut] = useState(editing?.shortcut ?? "");

  const parentPath =
    props.mode === "create" && props.parentId ? pathOf(tree, props.parentId) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      if (props.mode === "create") {
        const created = await create.mutateAsync({
          name,
          color,
          description,
          inclusion,
          exclusion,
          parentId: props.parentId,
          shortcut: shortcut || null,
        });
        props.onCreated?.(created);
      } else {
        await update.mutateAsync({
          id: props.code.id,
          patch: { name, color, description, inclusion, exclusion, shortcut: shortcut || null },
        });
      }
      props.onClose();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent
        title={editing ? "Edit code" : parentPath ? `New code under ${parentPath}` : "New code"}
      >
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-name">
              Name
            </label>
            <Input
              id="code-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              data-testid="code-name"
            />
          </div>
          <div>
            <span className="text-xs font-medium text-fg-muted">Color</span>
            <div className="mt-1">
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>
          {/* The three parts of a working code definition: what it means,
              when it applies, and when it does not (see docs/research). Only
              the description is shown in the palette while coding. */}
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-desc">
              Description — what it means
            </label>
            <Textarea
              id="code-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
              placeholder="What this code stands for…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-inclusion">
              Include when
            </label>
            <Textarea
              id="code-inclusion"
              rows={2}
              value={inclusion}
              onChange={(e) => setInclusion(e.target.value)}
              className="mt-1"
              placeholder="Apply this code when…"
              data-testid="code-inclusion"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-exclusion">
              Exclude when
            </label>
            <Textarea
              id="code-exclusion"
              rows={2}
              value={exclusion}
              onChange={(e) => setExclusion(e.target.value)}
              className="mt-1"
              placeholder="Do not apply it when… (and what to use instead)"
              data-testid="code-exclusion"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-shortcut">
              Hotkey (a letter or digit; press it with text selected to apply this code)
            </label>
            <Input
              id="code-shortcut"
              value={shortcut}
              maxLength={1}
              onChange={(e) =>
                setShortcut(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())
              }
              className="mt-1 w-16"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()} data-testid="code-submit">
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
