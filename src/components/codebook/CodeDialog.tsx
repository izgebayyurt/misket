import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { AssistedRef, Code, WeightScale } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { ColorPicker } from "./ColorSwatch";
import { useCodes, useCreateCode, useUpdateCode } from "@/queries/codes";
import { nextColor, pathOf } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import { formatWeight, validateWeightScale } from "@/core/weights";
import { toast } from "@/state/toasts";
import { DraftDefinitionButton } from "@/components/assist/DraftDefinition";

type Props =
  | {
      mode: "create";
      parentId: string | null;
      onClose: () => void;
      onCreated?: (code: Code) => void;
      /** Prefill the name — a "new code" suggestion the person clicked. */
      initialName?: string;
      /** Set when the name came from a draft, so the history entry says so. */
      assisted?: AssistedRef;
    }
  | { mode: "edit"; code: Code; onClose: () => void };

export function CodeDialog(props: Props) {
  const { t } = useTranslation();
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const create = useCreateCode();
  const update = useUpdateCode();
  const editing = props.mode === "edit" ? props.code : null;
  const [name, setName] = useState(
    editing?.name ?? (props.mode === "create" ? (props.initialName ?? "") : ""),
  );
  const [color, setColor] = useState(editing?.color ?? nextColor(codes ?? []));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [inclusion, setInclusion] = useState(editing?.inclusion ?? "");
  const [exclusion, setExclusion] = useState(editing?.exclusion ?? "");
  const [shortcut, setShortcut] = useState(editing?.shortcut ?? "");
  /**
   * Whether anything in this form started life as a draft. It rides along on
   * the save so the history entry can say the person had help; the fields
   * themselves are whatever is in the form when they press Save.
   */
  const [assisted, setAssisted] = useState<AssistedRef | undefined>(
    props.mode === "create" ? props.assisted : undefined,
  );
  /** A quotation the draft picked out as the clearest instance, if any. */
  const [draftedExample, setDraftedExample] = useState("");

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
      return { scale: null, error: t("codebook.weightScale.errorNotNumbers") };
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
    const problem = validateWeightScale(scale, t);
    return problem
      ? { scale: null, error: t("codebook.weightScale.error", { problem }) }
      : { scale, error: null };
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
          assisted,
        });
        props.onCreated?.(created);
      } else {
        await update.mutateAsync({
          assisted,
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
        title={
          editing
            ? t("codebook.dialog.editTitle")
            : parentPath
              ? t("codebook.dialog.newUnderTitle", { parent: parentPath })
              : t("codebook.dialog.newTitle")
        }
      >
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-name">
              {t("codebook.dialog.nameLabel")}
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
            <span className="text-xs font-medium text-fg-muted">
              {t("analysis.clustering.colorLabel")}
            </span>
            <div className="mt-1">
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>
          {/* The three parts of a working code definition: what it means,
              when it applies, and when it does not (see docs/research). Only
              the description is shown in the palette while coding. */}
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-desc">
              {t("codebook.dialog.descriptionLabel")}
            </label>
            <Textarea
              id="code-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
              placeholder={t("codebook.dialog.descriptionPlaceholder")}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-inclusion">
              {t("codebook.dialog.inclusionLabel")}
            </label>
            <Textarea
              id="code-inclusion"
              rows={2}
              value={inclusion}
              onChange={(e) => setInclusion(e.target.value)}
              className="mt-1"
              placeholder={t("codebook.dialog.inclusionPlaceholder")}
              data-testid="code-inclusion"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-exclusion">
              {t("codebook.dialog.exclusionLabel")}
            </label>
            <Textarea
              id="code-exclusion"
              rows={2}
              value={exclusion}
              onChange={(e) => setExclusion(e.target.value)}
              className="mt-1"
              placeholder={t("codebook.dialog.exclusionPlaceholder")}
              data-testid="code-exclusion"
            />
          </div>
          {editing ? (
            <div>
              <DraftDefinitionButton
                codeId={editing.id}
                codeName={name || editing.name}
                onDraft={(d, by) => {
                  // Straight into the form, still editable, still unsaved.
                  if (d.description) setDescription(d.description);
                  if (d.inclusion) setInclusion(d.inclusion);
                  if (d.exclusion) setExclusion(d.exclusion);
                  setDraftedExample(d.example);
                  setAssisted(by);
                }}
              />
              {draftedExample ? (
                <p className="mt-1 text-[11px] text-fg-muted" data-testid="drafted-example">
                  <Trans
                    i18nKey="codebook.dialog.draftedExample"
                    values={{ example: draftedExample }}
                    components={{ q: <q className="italic" /> }}
                  />
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="code-shortcut">
              {t("codebook.dialog.hotkeyLabel")}
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
                {t("codebook.dialog.weightScaleToggle")}
              </label>
              {hasScale ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-min">
                        {t("codebook.dialog.scaleMin")}
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
                        {t("codebook.dialog.scaleMax")}
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
                        {t("codebook.dialog.scaleStep")}
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
                        {t("codebook.dialog.scaleDefault")}
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
                        {t("codebook.dialog.labelFor", {
                          value: scaleMin || t("codebook.dialog.scaleMin"),
                        })}
                      </label>
                      <Input
                        id="scale-label-min"
                        value={labelMin}
                        onChange={(e) => setLabelMin(e.target.value)}
                        placeholder={t("codebook.dialog.labelExampleWeak")}
                        className="mt-0.5"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-fg-muted" htmlFor="scale-label-max">
                        {t("codebook.dialog.labelFor", {
                          value: scaleMax || t("codebook.dialog.scaleMax"),
                        })}
                      </label>
                      <Input
                        id="scale-label-max"
                        value={labelMax}
                        onChange={(e) => setLabelMax(e.target.value)}
                        placeholder={t("codebook.dialog.labelExampleStrong")}
                        className="mt-0.5"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-fg-muted">{t("codebook.dialog.scaleHint")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim()} data-testid="code-submit">
              {t(editing ? "common.save" : "analysis.clustering.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
