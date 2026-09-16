import { useState } from "react";
import { History } from "lucide-react";
import { useActivity } from "@/queries/activity";
import { absoluteTime, kindLabel, relativeTime } from "@/core/activity";
import type { ActivityEntry } from "@/api/types";

const PAGE = 100;

/**
 * The project's audit trail: the latest hundred things anyone did, newest
 * first, filterable by kind. The kinds offered are the ones the log actually
 * contains, so the menu stays short in a young project.
 */
export function ActivityFeed() {
  const [kind, setKind] = useState("");
  const { data, isLoading } = useActivity({
    limit: PAGE,
    kinds: kind ? [kind] : null,
  });

  const entries = data?.entries ?? [];

  return (
    <div data-testid="activity-feed">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-fg-muted">
          {data ? `${data.total.toLocaleString()} recorded` : ""}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-border bg-panel px-1.5 py-1 text-xs text-fg"
            data-testid="activity-kind-filter"
          >
            <option value="">All</option>
            {(data?.kinds ?? []).map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-fg-muted" data-testid="activity-empty">
          {kind
            ? "Nothing of that kind yet."
            : "Nothing recorded yet. Coding, editing the codebook and writing memos all show up here."}
        </p>
      ) : (
        <ul
          className="max-h-96 overflow-y-auto rounded-md border border-border bg-panel"
          data-testid="activity-list"
        >
          {entries.map((e) => (
            <ActivityRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li
      className="flex items-baseline gap-2 border-b border-border px-3 py-1.5 text-sm last:border-b-0"
      data-testid="activity-row"
    >
      <History className="size-3 shrink-0 self-center text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        {entry.summary}
        {entry.actor ? <span className="text-fg-muted"> — {entry.actor}</span> : null}
      </span>
      <span
        className="shrink-0 whitespace-nowrap text-xs tabular-nums text-fg-muted"
        title={absoluteTime(entry.at)}
      >
        {relativeTime(entry.at)}
      </span>
    </li>
  );
}
