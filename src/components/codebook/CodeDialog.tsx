import { useState } from "react";
import type { Code, WeightScale } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { ColorPicker } from "./ColorSwatch";
import { useCodes, useCreateCode, useUpdateCode } from "@/queries/codes";
import { nextColor, pathOf } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import { formatWeight, validateWeightScale } from "@/core/weights";
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

  // A weight scale is edit-only: a fresh code has nowhere for a rating to
  // live yet, and giving it one is exactly the same "edit code" action as
  // any other field, once it exists.
  const existingScale = editing?.weightScale ?? null;
  const [hasScale, setHasScale] = useState(!!existingScale);
  const [scaleMin, setScaleMin] = useState(String(existingScale?.min ?? 1));
  const [scaleMax, setScaleMax] = useState(String(existingScale?.max ?? 5));
  const [scaleStep, setScaleStep] = useState(String(existingScale?.step ?? 1));
  const [scaleDefault, setScaleDefault] = useState(String(existingScale?.default ?? 3));
  const [labelMin, setLabelMin] = useState(
    existingScale ? (existingScale.labels?.[formatWeight(existingScale.min)] ?? "") : "",
  );
  const [labelMax, setLabelMax] = useState(
    existingScale ? (existingScale.labels?.[formatWeight(existingScale.max)] ?? "") : "",
  );

  const parentPath =
    props.mode === "create" && props.parentId ? pathOf(tree, props.parentId) : null;

  /** The scale as the form has it, or an error to show instead of saving. */
  function buildScale(): { scale: WeightScale | null; error: string | null } {
    if (!hasScale) return { scale: null, error: null };
    const [min, max, step, def] = [scaleMin, scaleMax, scaleStep, scaleDefault].map(Number);
    if ([min, max, step, def].some((n) => Number.isNaN(n))) {
      return { scale: null, error: "Weight scale: min, max, step and default must be numbers." };
    }
    const labels: Record<string, string> = {};
    if (labelMin.trim()) labels[formatWeight(min!)] = labelMin.trim();
    if (labelMax.trim()) labels[formatWeight(max!)] = labelMax.trim();
    const scale: WeightScale = {
      min: min!,
      max: max!,
      step: step!,
      default: def!,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    };
    const problem = validateWeightScale(scale);
    return problem ? { scale: null, error: `Weight scale: ${problem}.` } : { scale, error: null };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { scale, error } = buildScale();
    if (error) {
      toast.error(error);
      return;
    }
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
          patch: {
            name,
            color,
            description,
            inclusion,
            exclusion,
            shortcut: shortcut || null,
            weightScale: scale,
          },
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
          {editing ? (
            <div className="rounded-md border border-border p-2.5" data-testid="weight-scale">
              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={hasScale}
                  onChange={(e) => setHasScale(e.target.checked)}
                  data-testid="weight-scale-toggle"
                />
                Weight scale — rate each application on a numeric scale
              </label>
              {hasScale ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-min">
                        Min
                      </label>
                      <Input
                        id="scale-min"
                        type="number"
                        value={scaleMin}
                        onChange={(e) => setScaleMin(e.target.value)}
                        className="mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-max">
                        Max
                      </label>
                      <Input
                        id="scale-max"
                        type="number"
                        value={scaleMax}
                        onChange={(e) => setScaleMax(e.target.value)}
                        className="mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-step">
                        Step
                      </label>
                      <Input
                        id="scale-step"
                        type="number"
                        value={scaleStep}
                        onChange={(e) => setScaleStep(e.target.value)}
                        className="mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-default">
                        Default
                      </label>
                      <Input
                        id="scale-default"
                        type="number"
                        value={scaleDefault}
                        onChange={(e) => setScaleDefault(e.target.value)}
                        className="mt-0.5"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-label-min">
                        Label for {scaleMin || "min"} (optional)
                      </label>
                      <Input
                        id="scale-label-min"
                        value={labelMin}
                        onChange={(e) => setLabelMin(e.target.value)}
                        placeholder="e.g. weak"
                        className="mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-label-max">
                        Label for {scaleMax || "max"} (optional)
                      </label>
                      <Input
                        id="scale-label-max"
                        value={labelMax}
                        onChange={(e) => setLabelMax(e.target.value)}
                        placeholder="e.g. strong"
                        className="mt-0.5"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-fg-muted">
                    Every fresh coding of this code starts at the default; clearing the scale
                    removes every weight recorded under it.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
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
