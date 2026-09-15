import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Memo, MemoTarget } from "@/api/types";
import { Input, Textarea } from "@/components/ui/input";
import { pendingMemoFocus, useDeleteMemo, useUpdateMemo } from "@/queries/memos";
import { toast } from "@/state/toasts";

/** One memo: title + body with debounced autosave and save-on-blur. */
export function MemoEditor({ memo, target }: { memo: Memo; target: MemoTarget }) {
  const update = useUpdateMemo();
  const del = useDeleteMemo();
  const [title, setTitle] = useState(memo.title);
  const [body, setBody] = useState(memo.body);
  const timer = useRef<number | null>(null);
  const latest = useRef({ title, body });
  useEffect(() => {
    latest.current = { title, body };
  });

  const save = useCallback(
    (t: string, b: string) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      if (t === memo.title && b === memo.body) return;
      update.mutateAsync({ id: memo.id, title: t, body: b, target }).catch(toast.error);
    },
    [memo.id, memo.title, memo.body, target, update],
  );

  function scheduleSave(t: string, b: string) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(t, b), 500);
  }

  // Flush a pending save when the editor unmounts (e.g. switching panels).
  useEffect(() => {
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        const { title, body } = latest.current;
        save(title, body);
      }
    };
  }, [save]);

  return (
    <div className="group rounded-md border border-border bg-panel p-2" data-testid="memo">
      <div className="flex items-center gap-1">
        <Input
          ref={(el) => {
            if (el && pendingMemoFocus.id === memo.id) {
              pendingMemoFocus.id = null;
              el.focus();
            }
          }}
          value={title}
          placeholder="Title"
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave(e.target.value, body);
          }}
          onBlur={() => save(title, body)}
          className="h-7 border-0 bg-transparent px-1 font-medium focus-visible:ring-0"
          data-testid="memo-title"
        />
        <button
          className="rounded p-1 text-fg-muted opacity-0 hover:bg-muted hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Delete memo"
          onClick={() => del.mutateAsync({ memo }).catch(toast.error)}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <Textarea
        value={body}
        placeholder="Write a memo…"
        rows={4}
        onChange={(e) => {
          setBody(e.target.value);
          scheduleSave(title, e.target.value);
        }}
        onBlur={() => save(title, body)}
        className="mt-1 resize-y border-0 bg-transparent px-1 focus-visible:ring-0"
        data-testid="memo-body"
      />
      <div className="px-1 text-[10px] text-fg-muted">
        {new Date(memo.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}
