import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpeakerTurn } from "@/api/types";
import { useTranscript } from "@/queries/transcripts";
import { useCodeTree } from "@/queries/codes";
import { useAutoCode } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";

interface SpeakerGroup {
  speaker: string;
  turns: SpeakerTurn[];
}

/** Groups detected speaker turns by speaker, keeping first-seen order. */
function groupBySpeaker(turns: SpeakerTurn[]): SpeakerGroup[] {
  const bySpeaker = new Map<string, SpeakerTurn[]>();
  for (const t of turns) {
    const list = bySpeaker.get(t.speaker);
    if (list) list.push(t);
    else bySpeaker.set(t.speaker, [t]);
  }
  return [...bySpeaker].map(([speaker, speakerTurns]) => ({ speaker, turns: speakerTurns }));
}

/**
 * The document header's "Speakers" menu: lists every speaker in the
 * transcript, as the document's stored format reads it (`db::transcripts`),
 * with a turn count, and offers "Code all turns of <speaker> with…",
 * auto-coding every one of their turns — the spoken text, never the label —
 * with a single chosen code.
 */
export function SpeakersMenu({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const { data: transcript } = useTranscript(documentId);
  const openCodePicker = useWorkspace((s) => s.openCodePicker);
  const autoCode = useAutoCode();
  const tree = useCodeTree();

  const turns = transcript?.turns;
  if (!turns || turns.length === 0) return null;
  const groups = groupBySpeaker(turns);

  function codeAllTurnsOf(group: SpeakerGroup) {
    openCodePicker({
      label: t("documentView.codeAllTurnsOf", { speaker: group.speaker }),
      onPick: async (codeId) => {
        const codeName = tree.byId.get(codeId)?.code.name ?? t("documentView.defaultCodeName");
        const n = group.turns.length;
        try {
          const report = await autoCode.mutateAsync({
            hits: group.turns.map((t) => ({
              documentId,
              startPos: t.start,
              endPos: t.end,
            })),
            codeId,
            label: t("documentView.codeTurnsLabel", {
              count: n,
              speaker: group.speaker,
              code: codeName,
            }),
          });
          const touched = report.createdExcerptIds.length + report.reusedExcerptIds.length;
          const already = report.alreadyCoded
            ? t("documentView.alreadyCodedSuffix", { count: report.alreadyCoded })
            : "";
          toast.info(
            t("documentView.codedTurns", {
              count: touched,
              speaker: group.speaker,
              code: codeName,
              already,
            }),
          );
        } catch (e) {
          toast.error(e);
        }
      },
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-muted"
          data-testid="speakers-menu"
        >
          <Mic className="size-3" /> {t("documentView.speakersButton", { count: groups.length })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {groups.map((group) => (
          <DropdownMenuItem
            key={group.speaker}
            onSelect={() => codeAllTurnsOf(group)}
            className="flex-col items-start gap-0.5"
            data-testid="speaker-item"
          >
            <span className="text-sm font-medium">{group.speaker}</span>
            <span className="text-xs text-fg-muted">
              {t("documentView.turnsCodeAllWith", { count: group.turns.length })}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-[11px] text-fg-muted">{t("documentView.speakersHint")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
