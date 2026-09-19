import { useRef, useState } from "react";
import { AlertTriangle, Check, Copy, History, Highlighter, Plus, Tag, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/lib/i18n";
import { useProjectInfo, useProjectStats, useRenameProject } from "@/queries/project";
import { useDocuments } from "@/queries/documents";
import { useCodes, useCodeTree } from "@/queries/codes";
import { useCreateMemo, useMemos } from "@/queries/memos";
import { useCodeTimeline } from "@/queries/analysis";
import { useSets } from "@/queries/sets";
import { useCoders } from "@/queries/coders";
import { pathOf } from "@/core/codeTree";
import { sparklineAreaPath, sparklineLinePath, zeroFillDays } from "@/core/sparkline";
import { relativeTime } from "@/core/activity";
import { CodePicker } from "@/components/analysis/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { CodeDialog } from "@/components/codebook/CodeDialog";
import { MemoEditor } from "@/components/memos/MemoEditor";
import { useImportFiles } from "@/components/documents/useImportFiles";
import { useRelinkMedia } from "@/components/documents/useRelinkMedia";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import type { MissingMedia, ProjectStats } from "@/api/types";

/** The project's home screen: identity, memo, statistics and a way in. */
export function OverviewView() {
  const { t } = useTranslation();
  const { data: project } = useProjectInfo();
  const { data: stats } = useProjectStats();
  const { data: docs } = useDocuments();
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const [editingName, setEditingName] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const [sparklineCodeId, setSparklineCodeId] = useState<string | null>(null);
  const rename = useRenameProject();
  const { pickAndImport } = useImportFiles();
  const openDocument = useWorkspace((s) => s.openDocument);
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const setView = useWorkspace((s) => s.setView);

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
      toast.info(t("overview.pathCopied"));
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
              title={t("overview.copyPathTitle")}
              data-testid="copy-path"
            >
              <Copy /> {t("overview.copyPath")}
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

        {stats?.missingMedia.length ? <MissingMediaSection rows={stats.missingMedia} /> : null}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("overview.projectMemo")}
          </h2>
          <ProjectMemo />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("overview.statistics")}
          </h2>
          <StatGrid stats={stats} />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {t("overview.excerptsCodedLast30Days")}
            </h2>
            <CodePicker
              value={sparklineCodeId}
              onChange={setSparklineCodeId}
              allLabel={t("analysis.allCodes")}
              testId="overview-sparkline-code-picker"
            />
          </div>
          {sparklineCodeId ? (
            <CodeSparkline codeId={sparklineCodeId} />
          ) : (
            <Sparkline data={stats?.excerptsPerDay ?? []} />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("overview.topCodes")}
          </h2>
          <TopCodes
            topCodes={stats?.topCodes ?? []}
            tree={tree}
            onOpen={(id) => openExcerpts({ codeIds: [id], includeDescendants: false })}
          />
        </section>

        <CodersOverview onOpen={(id) => openExcerpts({ coderIds: [id] })} />

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {t("overview.activity")}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setView({ kind: "history" })}
              data-testid="open-history-from-overview"
            >
              <History /> {t("overview.openHistory")}
            </Button>
          </div>
          <ActivityFeed />
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t("overview.sets")}
          </h2>
          <SetsOverview
            onOpenCodeSet={(id) => openExcerpts({ codeSetIds: [id] })}
            onOpenDocumentSet={(id) => openExcerpts({ documentSetIds: [id] })}
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
  const { t } = useTranslation();
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
        aria-label={t("overview.projectNameLabel")}
        data-testid="project-name-input"
      />
    );
  }
  return (
    // A heading can't also carry an interactive role (h1 stays a heading for
    // screen-reader navigation); the button role, its handlers and the
    // visible focus ring live on this wrapper instead.
    <div
      tabIndex={0}
      role="button"
      title={t("overview.renameHint")}
      onClick={onStartEdit}
      onKeyDown={(e) => {
        if (e.key === "F2" || e.key === "Enter") {
          e.preventDefault();
          onStartEdit();
        }
      }}
      className="inline-block max-w-full truncate rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus"
      data-testid="project-name-heading"
    >
      <h1 className="truncate font-serif text-2xl font-medium text-fg">{name}</h1>
    </div>
  );
}

function ProjectMemo() {
  const { t } = useTranslation();
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
          <Plus /> {t("overview.addProjectMemo")}
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
  const { t } = useTranslation();
  return (
    <section className="rounded-md border border-border bg-panel p-3" data-testid="getting-started">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("overview.gettingStarted")}
      </h2>
      <ul className="space-y-1.5">
        <ChecklistItem done={hasDocument} label={t("overview.checklistImportDocument")}>
          {!hasDocument ? (
            <Button size="sm" variant="outline" onClick={onImport} data-testid="checklist-import">
              <Upload /> {t("overview.importEllipsis")}
            </Button>
          ) : null}
        </ChecklistItem>
        <ChecklistItem done={hasCode} label={t("overview.checklistCreateCode")}>
          {!hasCode ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onCreateCode}
              data-testid="checklist-create-code"
            >
              <Tag /> {t("overview.newCodeEllipsis")}
            </Button>
          ) : null}
        </ChecklistItem>
        <ChecklistItem done={hasCodedExcerpt} label={t("overview.checklistCodeExcerpt")}>
          {!hasCodedExcerpt ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!firstDocumentId}
              onClick={() => firstDocumentId && onOpenDocument(firstDocumentId)}
              title={firstDocumentId ? undefined : t("overview.importDocumentFirst")}
              data-testid="checklist-code-excerpt"
            >
              <Highlighter /> {t("overview.openADocument")}
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

const STAT_ROWS: { key: keyof ProjectStats; labelKey: string }[] = [
  { key: "documents", labelKey: "overview.stats.documents" },
  { key: "codes", labelKey: "overview.stats.codes" },
  { key: "excerpts", labelKey: "overview.stats.excerpts" },
  { key: "codedExcerpts", labelKey: "overview.stats.codedExcerpts" },
  { key: "memos", labelKey: "overview.stats.memos" },
  { key: "descriptorFields", labelKey: "overview.stats.descriptorFields" },
];

/**
 * The recordings whose files have moved.
 *
 * Audio and video are held by reference, so this is the one place that can
 * tell the whole story at once — and every row can be repaired from here
 * without opening the document first.
 */
function MissingMediaSection({ rows }: { rows: MissingMedia[] }) {
  const { t } = useTranslation();
  const relink = useRelinkMedia();
  const openDocument = useWorkspace((s) => s.openDocument);
  return (
    <section data-testid="overview-missing-media">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-danger">
        <AlertTriangle className="size-3.5" />
        {t("overview.missingMedia.heading", { count: rows.length })}
      </h2>
      <p className="mb-2 text-xs text-fg-muted">{t("overview.missingMedia.explanation")}</p>
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-panel">
        {rows.map((row) => (
          <li key={row.documentId} className="flex items-center gap-3 px-3 py-2">
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => openDocument(row.documentId)}
              data-testid="missing-media-row"
            >
              <div className="truncate text-sm">{row.name}</div>
              <div className="truncate font-mono text-[11px] text-fg-muted">
                {row.sourcePath ?? t("overview.missingMedia.noPathRecorded")}
              </div>
            </button>
            <Button
              size="sm"
              variant="ghost"
              disabled={relink.isPending}
              onClick={() => void relink.pickAndRelink(row.documentId)}
            >
              {t("overview.missingMedia.relinkEllipsis")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatGrid({ stats }: { stats: ProjectStats | undefined }) {
  const { t } = useTranslation();
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
          <div className="text-xs text-fg-muted">{t(row.labelKey)}</div>
        </div>
      ))}
      <div className="rounded-md border border-border bg-panel p-3" data-testid="stat-media">
        <div className="text-2xl font-medium tabular-nums text-fg">
          {stats ? formatCount(stats.imageDocuments + stats.mediaDocuments) : "–"}
        </div>
        <div className="text-xs text-fg-muted">{t("overview.stats.imagesAndRecordings")}</div>
      </div>
      <div className="rounded-md border border-border bg-panel p-3" data-testid="stat-textLength">
        <div className="text-2xl font-medium tabular-nums text-fg">
          {stats ? formatCount(stats.totalTextLength) : "–"}
        </div>
        <div className="text-xs text-fg-muted">{t("overview.stats.charactersTranscribed")}</div>
      </div>
      <div className="rounded-md border border-border bg-panel p-3" data-testid="stat-lastActivity">
        <div className="text-2xl font-medium text-fg">
          {stats?.lastActivityAt
            ? relativeTime(stats.lastActivityAt, undefined, currentLocale())
            : "–"}
        </div>
        <div className="text-xs text-fg-muted">{t("overview.stats.lastActivity")}</div>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString(currentLocale());
}

const SPARK_WIDTH = 300;
const SPARK_HEIGHT = 48;

function Sparkline({ data }: { data: [string, number][] }) {
  const { t } = useTranslation();
  const values = data.map(([, c]) => c);
  const total = values.reduce((a, b) => a + b, 0);
  const options = { width: SPARK_WIDTH, height: SPARK_HEIGHT };
  const line = sparklineLinePath(values, options);
  const area = sparklineAreaPath(values, options);
  const from = data[0]?.[0];
  const to = data[data.length - 1]?.[0];

  if (total === 0) {
    return <p className="text-sm text-fg-muted">{t("overview.sparkline.noneLast30Days")}</p>;
  }

  return (
    <div className="rounded-md border border-border bg-panel p-3" data-testid="sparkline">
      <svg
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        className="h-12 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("overview.sparkline.ariaLabel", { count: total, from, to })}
      >
        <path d={area} fill="var(--color-accent)" opacity="0.15" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
        <span>{from}</span>
        <span>{t("overview.sparkline.total", { count: total })}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}

/** The same 30-day sparkline as `Sparkline`, but for one code (with its
 * sub-codes) rather than every excerpt, zero-filled the same way. */
function CodeSparkline({ codeId }: { codeId: string }) {
  const { data, isPending } = useCodeTimeline(codeId, true, "day");
  const filled = zeroFillDays(data ?? [], 30);
  if (isPending) return null;
  return <Sparkline data={filled} />;
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
  const { t } = useTranslation();
  const rows = topCodes
    .map(([codeId, count]) => ({ codeId, count, code: tree.byId.get(codeId)?.code }))
    .filter((r): r is { codeId: string; count: number; code: NonNullable<typeof r.code> } =>
      Boolean(r.code),
    );

  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">{t("overview.noExcerptsCodedYet")}</p>;
  }

  const max = Math.max(...rows.map((r) => r.count));

  return (
    <ul className="space-y-1">
      {rows.map(({ codeId, count, code }) => (
        <li key={codeId}>
          <button
            type="button"
            onClick={() => onOpen(codeId)}
            title={t("overview.showExcerptsCoded", { path: pathOf(tree, codeId) })}
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

/**
 * Who has worked on this project, and how much of it is theirs. Hidden until
 * there is more than one coder, because a project with one person in it has
 * nothing to compare.
 */
function CodersOverview({ onOpen }: { onOpen: (coderId: string) => void }) {
  const { t } = useTranslation();
  const { data: coders } = useCoders();
  if (!coders || coders.length < 2) return null;
  const max = Math.max(...coders.map((c) => c.codingCount), 1);
  return (
    <section data-testid="overview-coders">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {t("overview.coders")}
      </h2>
      <ul className="space-y-1">
        {coders.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              title={t("overview.showExcerptsCodedBy", { name: c.name })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
              data-testid="coder-row"
            >
              <ColorDot color={c.color} />
              <span className="min-w-0 flex-1 truncate">
                {c.name}
                {c.isLocal ? (
                  <span className="text-fg-muted"> {t("overview.youSuffix")}</span>
                ) : null}
              </span>
              <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(c.codingCount / max) * 100}%`, background: c.color }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                {t("overview.codingCount", { count: c.codingCount })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Code sets and document sets, compactly: a name and a member count, click
 * to browse those members' excerpts. A one-line hint replaces the list when
 * the project has no sets yet.
 */
function SetsOverview({
  onOpenCodeSet,
  onOpenDocumentSet,
}: {
  onOpenCodeSet: (id: string) => void;
  onOpenDocumentSet: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: codeSets } = useSets("code");
  const { data: docSets } = useSets("document");
  const hasSets = (codeSets?.length ?? 0) > 0 || (docSets?.length ?? 0) > 0;

  if (!hasSets) {
    return (
      <p className="text-sm text-fg-muted" data-testid="sets-overview-empty">
        {t("overview.noSetsYet")}
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="sets-overview">
      <SetGroupList title={t("overview.codeSets")} sets={codeSets ?? []} onOpen={onOpenCodeSet} />
      <SetGroupList
        title={t("overview.documentSets")}
        sets={docSets ?? []}
        onOpen={onOpenDocumentSet}
      />
    </div>
  );
}

function SetGroupList({
  title,
  sets,
  onOpen,
}: {
  title: string;
  sets: { id: string; name: string; memberCount: number }[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (sets.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <h3 className="mb-1.5 text-xs font-medium text-fg-muted">{title}</h3>
      <ul className="space-y-0.5">
        {sets.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              title={t("overview.showExcerptsInSet", { name: s.name })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
              data-testid="overview-set-row"
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-fg-muted">{s.memberCount}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
