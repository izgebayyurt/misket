import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MemoTarget } from "@/api/types";
import { Button } from "@/components/ui/button";
import { useCreateMemo, useMemos } from "@/queries/memos";
import { MemoEditor } from "./MemoEditor";
import { toast } from "@/state/toasts";
import { describe } from "@/core/keymap";

export function MemoList({ target, heading }: { target: MemoTarget; heading: string }) {
  const { t } = useTranslation();
  const { data: memos } = useMemos(target);
  const create = useCreateMemo();
  async function add() {
    try {
      await create.mutateAsync({ target });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <section className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{heading}</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={add}
          title={`${t("memos.newMemo")} (${describe("newMemo")})`}
          data-testid="new-memo"
        >
          <Plus /> {t("memos.memo")}
        </Button>
      </div>
      {memos?.length === 0 ? <p className="text-xs text-fg-muted">{t("memos.noneYet")}</p> : null}
      {memos?.map((m) => (
        <MemoEditor key={m.id} memo={m} target={target} />
      ))}
    </section>
  );
}
