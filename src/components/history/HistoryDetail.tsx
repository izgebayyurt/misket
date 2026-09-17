import { BookMarked, Crosshair, FileText, GitFork, Layers } from "lucide-react";
import type { HistoryRef } from "@/api/types";
import { absoluteTime, kindLabel, relativeTime } from "@/core/activity";
import { detailFields } from "@/core/historyDetail";
import { useHistoryNode } from "@/queries/history";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What one step of the history actually did, for the panel down the right of
 * the history view.
 *
 * Selecting a step used to move the project to it, which is a lot to do on
 * one click. Now a click only asks "what was this?" and this panel answers:
 * the excerpt that was coded with its codes, the code that was created with
 * its colour and place, the document that was imported, the memo that was
 * written — each with a way to go and look at it, and, separately, an
 * explicit "Go to this point" for actually moving the project there.
 *
 * Every reference is resolved by `history_node` against the project as it is
 * now, so something that has since been deleted says so instead of offering
 * a link that goes nowhere.
 */
export function HistoryDetail({
  nodeId,
  onCheckout,
  onFork,
  onSelectNode,
}: {
  nodeId: number | null;
  onCheckout: () => void;
  onFork: () => void;
  /** Jump the list to another step (a compound step's member, the parent). */
  onSelectNode: (id: number) => void;
}) {
  const { data, isLoading, error } = useHistoryNode(nodeId);

  if (nodeId == null) {
    return (
      <aside
        className="hidden w-80 shrink-0 flex-col border-l border-border bg-panel p-4 lg:flex"
        data-testid="history-detail"
      >
        <p className="text-sm text-fg-muted">
          Pick a step to see what it did. Nothing moves until you say so:
          <span className="font-medium"> Go to this point</span> is a button of its own.
        </p>
      </aside>
    );
  }

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel"
      data-testid="history-detail"
    >
      {isLoading ? (
        <p className="p-4 text-sm text-fg-muted">Loading…</p>
      ) : error || !data ? (
        <p className="p-4 text-sm text-danger">
          {error instanceof Error ? error.message : "That step could not be read."}
        </p>
      ) : (
        <>
          <div className="border-b border-border p-3">
            <p className="text-sm font-medium" data-testid="history-detail-summary">
              {data.summary}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              <span>{kindLabel(data.kind)}</span>
              {data.actor ? <span>· {data.actor}</span> : null}
              <span title={absoluteTime(data.at)}>· {relativeTime(data.at)}</span>
              {data.stepCount > 1 ? <span>· {data.stepCount} changes in one step</span> : null}
            </p>
            {data.branchName ? (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-[11px] text-fg">
                <GitFork className="size-3" /> {data.branchName}
              </p>
            ) : null}
            {data.isHead ? (
              <p className="mt-2 text-xs font-medium text-accent">The project is at this step.</p>
            ) : data.applied ? null : (
              <p className="mt-2 text-xs text-fg-muted" data-testid="history-detail-unapplied">
                Not in force: the project has been taken back past this step, or is on another
                branch. What it did is described below all the same.
              </p>
            )}
            {data.undoable ? null : (
              <p className="mt-2 text-xs text-fg-muted">
                This step carries no inverse, so it cannot be replayed backwards.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={onCheckout}
                disabled={data.isHead}
                data-testid="history-detail-checkout"
                title="Move the project to this step (G)"
              >
                <Crosshair /> Go to this point
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onFork}
                data-testid="history-detail-fork"
              >
                <GitFork /> Fork here…
              </Button>
            </div>
          </div>

          {data.refs.length > 0 ? (
            <section className="border-b border-border p-3">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                What it touched
              </h3>
              <ul className="space-y-2" data-testid="history-detail-refs">
                {data.refs.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    <RefRow ref_={r} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <DetailTable detail={data.detail} />

          {data.members.length > 0 ? (
            <section className="border-b border-border p-3">
              <h3 className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                <Layers className="size-3" /> The {data.members.length} changes inside
              </h3>
              <ol className="space-y-1 text-xs" data-testid="history-detail-members">
                {data.members.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <span className="shrink-0 text-fg-muted">{kindLabel(m.kind)}</span>
                    <span className="min-w-0 flex-1 break-words">{m.summary}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {data.parentId != null ? (
            <div className="p-3">
              <button
                type="button"
                className="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                onClick={() => onSelectNode(data.parentId!)}
                data-testid="history-detail-parent"
              >
                Show the step before this one
              </button>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

/** The step's `detail` payload as a plain key-value list. */
function DetailTable({ detail }: { detail: Record<string, unknown> }) {
  const fields = detailFields(detail);
  if (fields.length === 0) return null;
  return (
    <section className="border-b border-border p-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Detail</h3>
      <dl className="space-y-1 text-xs" data-testid="history-detail-fields">
        {fields.map((f) => (
          <div key={f.key} className="flex gap-2">
            <dt className="w-24 shrink-0 text-fg-muted">{f.label}</dt>
            <dd className="min-w-0 flex-1 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One resolved reference, with the way to go and look at it. */
function RefRow({ ref_ }: { ref_: HistoryRef }) {
  const openDocument = useWorkspace((s) => s.openDocument);
  const setSidebarTab = useWorkspace((s) => s.setSidebarTab);
  const setSelectedCodeId = useWorkspace((s) => s.setSelectedCodeId);

  if (ref_.kind === "code") {
    return (
      <div className="flex items-start gap-2">
        <span
          className="mt-1 size-3 shrink-0 rounded-full border border-border"
          style={ref_.color ? { background: ref_.color } : undefined}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className={cn("break-words text-sm", !ref_.exists && "text-fg-muted italic")}>
            {ref_.label}
          </p>
          {ref_.path ? <p className="break-words text-[11px] text-fg-muted">{ref_.path}</p> : null}
          {ref_.exists ? (
            <button
              type="button"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={() => {
                setSidebarTab("codes");
                setSelectedCodeId(ref_.id);
              }}
              data-testid="history-show-in-codebook"
            >
              <BookMarked className="size-3" /> Show in codebook
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (ref_.kind === "excerpt") {
    const documentId = ref_.documentId ?? null;
    return (
      <div className="min-w-0">
        <blockquote
          className={cn(
            "border-l-2 border-border pl-2 text-sm",
            !ref_.exists && "text-fg-muted italic",
          )}
          data-testid="history-excerpt-snippet"
        >
          {ref_.label}
        </blockquote>
        {documentId ? (
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
            onClick={() =>
              openDocument(
                documentId,
                ref_.exists ? ref_.id : undefined,
                ref_.exists ? undefined : (ref_.startPos ?? undefined),
              )
            }
            data-testid="history-show-in-document"
          >
            <FileText className="size-3" />
            {ref_.exists ? "Show in document" : "Show where it was"}
          </button>
        ) : null}
      </div>
    );
  }

  if (ref_.kind === "document") {
    return (
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={cn("break-words text-sm", !ref_.exists && "text-fg-muted italic")}>
            {ref_.label}
          </p>
          {ref_.exists ? (
            <button
              type="button"
              className="mt-0.5 text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={() => openDocument(ref_.id)}
              data-testid="history-open-document"
            >
              Open document
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <p className={cn("break-words text-sm", !ref_.exists && "text-fg-muted italic")}>
      {ref_.label}
    </p>
  );
}
