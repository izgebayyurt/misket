import { useRef, useState } from "react";
import { Check, Copy, Highlighter, Plus, Tag, Upload } from "lucide-react";
import { useProjectInfo, useProjectStats, useRenameProject } from "@/queries/project";
import { useDocuments } from "@/queries/documents";
import { useCodes, useCodeTree } from "@/queries/codes";
import { useCreateMemo, useMemos } from "@/queries/memos";
import { pathOf } from "@/core/codeTree";
import { sparklineAreaPath, sparklineLinePath } from "@/core/sparkline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { CodeDialog } from "@/components/codebook/CodeDialog";
import { MemoEditor } from "@/components/memos/MemoEditor";
import { useImportFiles } from "@/components/documents/useImportFiles";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import type { ProjectStats } from "@/api/types";

/** The project's home screen: identity, memo, statistics and a way in. */
export function OverviewView() {
  const { data: project } = useProjectInfo();
  const { data: stats } = useProjectStats();
  const { data: docs } = useDocuments();
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const [editingName, setEditingName] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const rename = useRenameProject();
  const { pickAndImport } = useImportFiles();
  const openDocument = useWorkspace((s) => s.openDocument);
  const openExcerpts = useWorkspace((s) => s.openExcerpts);

  if (!project) return null;

  const hasDocument = (docs?.length ?? 0) > 0;
  const hasCode = (codes?.length ?? 0) > 0;
  const hasCodedExcerpt = (stats?.codedExcerpts ?? 0) > 0;
  const gettingStartedDone = hasDocument && hasCode && hasCodedExcerpt;

  async function saveName(name: string) {
    setEditingName(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === project!.name) return;
    try {
      await rename.mutateAsync(trimmed);
    } catch (e) {
      toast.error(e);
    }
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(project!.path);
      toast.info("Path copied");
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="overview">
      <div className="mx-auto max-w-3xl space-y-8 p-8">
        <header>
          <ProjectNameHeading
            name={project.name}
            editing={editingName}
            onStartEdit={() => setEditingName(true)}
            onSave={saveName}
            onCancel={() => setEditingName(false)}
          />
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-fg-muted">
            <span className="min-w-0 truncate" title={project.path}>
              {project.path}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={copyPath}
              title="Copy the project file's path"
              data-testid="copy-path"
            >
              <Copy /> Copy path
            </Button>
          </div>
        </header>

        {!gettingStartedDone ? (
          <GettingStarted
            hasDocument={hasDocument}
            hasCode={hasCode}
            hasCodedExcerpt={hasCodedExcerpt}
            firstDocumentId={docs?.[0]?.id ?? null}
            onImport={() => void pickAndImport()}
            onCreateCode={() => setCreatingCode(true)}
            onOpenDocument={(id) => openDocument(id)}
          />
        ) : null}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Project memo
          </h2>
          <ProjectMemo />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Statistics
          </h2>
          <StatGrid stats={stats} />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Excerpts coded, last 30 days
          </h2>
          <Sparkline data={stats?.excerptsPerDay ?? []} />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Top codes
          </h2>
          <TopCodes
            topCodes={stats?.topCodes ?? []}
            tree={tree}
            onOpen={(id) => openExcerpts({ codeIds: [id], includeDescendants: false })}
          />
        </section>
      </div>
      {creatingCode ? (
        <CodeDialog mode="create" parentId={null} onClose={() => setCreatingCode(false)} />
      ) : null}
    </div>
  );
}

/** Click, or F2 while focused, to edit; Enter saves, Escape cancels. */
function ProjectNameHeading({
  name,
  editing,
  onStartEdit,
  onSave,
  onCancel,
}: {
  name: string;
  editing: boolean;
  onStartEdit: () => void;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        defaultValue={name}
        onBlur={() => onSave(inputRef.current?.value ?? "")}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(inputRef.current?.value ?? "");
          else if (e.key === "Escape") onCancel();
        }}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 max-w-md font-serif text-2xl"
        aria-label="Project name"
        data-testid="project-name-input"
      />
    );
  }
  return (
    <h1
      tabIndex={0}
      role="button"
      title="Click or press F2 to rename"
      onClick={onStartEdit}
      onKeyDown={(e) => {
        if (e.key === "F2" || e.key === "Enter") {
          e.preventDefault();
          onStartEdit();
        }
      }}
      className="inline-block max-w-full truncate rounded-md font-serif text-2xl font-medium text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
      data-testid="project-name-heading"
    >
      {name}
    </h1>
  );
}

function ProjectMemo() {
  const target = {};
  const { data: memos } = useMemos(target);
  const create = useCreateMemo();

  return (
    <div className="space-y-2">
      {memos?.length ? (
        memos.map((m) => <MemoEditor key={m.id} memo={m} target={target} />)
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => create.mutateAsync({ target }).catch(toast.error)}
          data-testid="add-project-memo"
        >
          <Plus /> Add a project memo
        </Button>
      )}
    </div>
  );
}

function GettingStarted({
  hasDocument,
  hasCode,
  hasCodedExcerpt,
  firstDocumentId,
  onImport,
  onCreateCode,
  onOpenDocument,
}: {
  hasDocument: boolean;
  hasCode: boolean;
  hasCodedExcerpt: boolean;
  firstDocumentId: string | null;
  onImport: () => void;
  onCreateCode: () => void;
  onOpenDocument: (id: string) => void;
}) {
  return (
    <section className="rounded-md border border-border bg-panel p-3" data-testid="getting-started">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Getting started
      </h2>
      <ul className="space-y-1.5">
        <ChecklistItem done={hasDocument} label="Import a document">
          {!hasDocument ? (
            <Button size="sm" variant="outline" onClick={onImport} data-testid="checklist-import">
              <Upload /> Import…
            </Button>
          ) : null}
        </ChecklistItem>
        <ChecklistItem done={hasCode} label="Create a code">
          {!hasCode ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onCreateCode}
              data-testid="checklist-create-code"
            >
              <Tag /> New code…
            </Button>
          ) : null}
        </ChecklistItem>
        <ChecklistItem done={hasCodedExcerpt} label="Code an excerpt">
          {!hasCodedExcerpt ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!firstDocumentId}
              onClick={() => firstDocumentId && onOpenDocument(firstDocumentId)}
              title={firstDocumentId ? undefined : "Import a document first"}
              data-testid="checklist-code-excerpt"
            >
              <Highlighter /> Open a document
            </Button>
          ) : null}
        </ChecklistItem>
      </ul>
    </section>
  );
}

function ChecklistItem({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            done ? "border-accent bg-accent text-accent-fg" : "border-border",
          )}
          aria-hidden
        >
          {done ? <Check className="size-3" /> : null}
        </span>
        <span className={cn(done && "text-fg-muted line-through")}>{label}</span>
      </span>
      {children}
    </li>
  );
}

const STAT_ROWS: { key: keyof ProjectStats; label: string }[] = [
  { key: "documents", label: "Documents" },
  { key: "codes", label: "Codes" },
  { key: "excerpts", label: "Excerpts" },
  { key: "codedExcerpts", label: "Coded excerpts" },
  { key: "memos", label: "Memos" },
  { key: "descriptorFields", label: "Descriptor fields" },
];

function StatGrid({ stats }: { stats: ProjectStats | undefined }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="stat-grid">
      {STAT_ROWS.map((row) => (
        <div
          key={row.key}
          className="rounded-md border border-border bg-panel p-3"
          data-testid={`stat-${row.key}`}
        >
          <div className="text-2xl font-medium tabular-nums text-fg">
            {stats ? formatCount(stats[row.key] as number) : "–"}
          </div>
          <div className="text-xs text-fg-muted">{row.label}</div>
        </div>
      ))}
      <div className="rounded-md border border-border bg-panel p-3" data-testid="stat-textLength">
        <div className="text-2xl font-medium tabular-nums text-fg">
          {stats ? formatCount(stats.totalTextLength) : "–"}
        </div>
        <div className="text-xs text-fg-muted">Characters transcribed</div>
      </div>
      <div className="rounded-md border border-border bg-panel p-3" data-testid="stat-lastActivity">
        <div className="text-2xl font-medium text-fg">
          {stats?.lastActivityAt ? formatRelative(stats.lastActivityAt) : "–"}
        </div>
        <div className="text-xs text-fg-muted">Last activity</div>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "–";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const SPARK_WIDTH = 300;
const SPARK_HEIGHT = 48;

function Sparkline({ data }: { data: [string, number][] }) {
  const values = data.map(([, c]) => c);
  const total = values.reduce((a, b) => a + b, 0);
  const options = { width: SPARK_WIDTH, height: SPARK_HEIGHT };
  const line = sparklineLinePath(values, options);
  const area = sparklineAreaPath(values, options);
  const from = data[0]?.[0];
  const to = data[data.length - 1]?.[0];

  if (total === 0) {
    return <p className="text-sm text-fg-muted">No excerpts coded in the last 30 days.</p>;
  }

  return (
    <div className="rounded-md border border-border bg-panel p-3" data-testid="sparkline">
      <svg
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        className="h-12 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${total} excerpts coded from ${from} to ${to}`}
      >
        <path d={area} fill="var(--color-accent)" opacity="0.15" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
        <span>{from}</span>
        <span>{total} total</span>
        <span>{to}</span>
      </div>
    </div>
  );
}

function TopCodes({
  topCodes,
  tree,
  onOpen,
}: {
  topCodes: [string, number][];
  tree: ReturnType<typeof useCodeTree>;
  onOpen: (codeId: string) => void;
}) {
  const rows = topCodes
    .map(([codeId, count]) => ({ codeId, count, code: tree.byId.get(codeId)?.code }))
    .filter((r): r is { codeId: string; count: number; code: NonNullable<typeof r.code> } =>
      Boolean(r.code),
    );

  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No excerpts coded yet.</p>;
  }

  const max = Math.max(...rows.map((r) => r.count));

  return (
    <ul className="space-y-1">
      {rows.map(({ codeId, count, code }) => (
        <li key={codeId}>
          <button
            type="button"
            onClick={() => onOpen(codeId)}
            title={`Show excerpts coded ${pathOf(tree, codeId)}`}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
            data-testid="top-code-row"
          >
            <ColorDot color={code.color} />
            <span className="min-w-0 flex-1 truncate">{pathOf(tree, codeId)}</span>
            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(count / max) * 100}%`, background: code.color }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-fg-muted">
              {count}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
