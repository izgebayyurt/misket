import { useMemo, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CodeRef, Query, QueryOp, QueryTerm } from "@/api/types";
import {
  addTerm,
  codeRef,
  describeQuery,
  emptyQuery,
  isCodeRef,
  minTerms,
  OP_HELP_KEY,
  OP_LABEL_KEY,
  QUERY_OPS,
  removeTerm,
  setOp,
  setTerm,
  validate,
} from "@/core/query";
import { flattenTree, pathOf } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClass } from "@/components/descriptors/DescriptorFieldForm";
import { cn } from "@/lib/utils";

/**
 * The excerpt browser's "Query" chip: a small builder for the Boolean and
 * proximity expressions `ExcerptFilter.query` carries ("A and B", "A not B",
 * "A near B within the same paragraph").
 *
 * The draft is local until "Apply", because a half-built query — a row with
 * no code yet — is one Rust would reject, and the result list should not
 * flicker through error states while a query is being assembled.
 */
export function QueryBuilder({
  query,
  onChange,
}: {
  query: Query | null;
  onChange: (q: Query | null) => void;
}) {
  const { t } = useTranslation();
  const tree = useCodeTree();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Query>(() => query ?? emptyQuery());

  const codeName = useMemo(() => {
    const byId = new Map(flattenTree(tree).map((n) => [n.code.id, n.code.name]));
    return (id: string) => byId.get(id) ?? "";
  }, [tree]);

  const problem = validate(draft, t);
  const label = query ? describeQuery(query, codeName, t) : t("excerpts.query.chipDefault");

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          // Reopening starts from whatever is applied, not from an abandoned
          // draft, so the popover always shows what the list is showing.
          if (o) setDraft(query ?? emptyQuery());
          setOpen(o);
        }}
      >
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex max-w-64 items-center gap-1 rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-muted",
              query && "border-accent bg-accent/10 text-fg",
            )}
            title={query ? describeQuery(query, codeName, t) : t("excerpts.query.buildHint")}
            data-testid="filter-query"
          >
            <span className="truncate">{label}</span>
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 p-3">
          <QueryEditor draft={draft} setDraft={setDraft} tree={tree} />
          <p className="mt-2 text-xs text-fg-muted">
            {problem ?? describeQuery(draft, codeName, t)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              disabled={!!problem}
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              data-testid="apply-query"
            >
              {t("excerpts.query.apply")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(null);
                setDraft(emptyQuery());
                setOpen(false);
              }}
              data-testid="clear-query"
            >
              {t("common.clear")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {query ? (
        <button
          className="ml-0.5 rounded p-0.5 text-fg-muted hover:bg-muted"
          onClick={() => onChange(null)}
          aria-label={t("excerpts.query.clearQuery")}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </>
  );
}

function QueryEditor({
  draft,
  setDraft,
  tree,
}: {
  draft: Query;
  setDraft: (q: Query) => void;
  tree: ReturnType<typeof useCodeTree>;
}) {
  const { t } = useTranslation();
  const scope = draft.within ?? { kind: "paragraph" as const };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <OpSelect value={draft.op} onChange={(op) => setDraft(setOp(draft, op))} />
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          {t(OP_HELP_KEY[draft.op])}
        </span>
      </div>
      {draft.op === "near" ? (
        <div className="flex items-center gap-2">
          <select
            className={cn(selectClass, "flex-1")}
            value={scope.kind}
            onChange={(e) =>
              setDraft({
                ...draft,
                within:
                  e.target.value === "chars" ? { kind: "chars", n: 200 } : { kind: "paragraph" },
              })
            }
            aria-label={t("excerpts.query.proximity")}
            data-testid="query-scope"
          >
            <option value="paragraph">{t("excerpts.query.scopeParagraph")}</option>
            <option value="chars">{t("excerpts.query.scopeChars")}</option>
          </select>
          {scope.kind === "chars" ? (
            <Input
              type="number"
              min={0}
              className="h-8 w-24"
              value={scope.n}
              onChange={(e) =>
                setDraft({ ...draft, within: { kind: "chars", n: Number(e.target.value) } })
              }
              aria-label={t("excerpts.query.characters")}
              data-testid="query-chars"
            />
          ) : null}
        </div>
      ) : null}
      <ol className="space-y-1.5">
        {draft.terms.map((term, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="w-10 shrink-0 pt-1.5 text-right text-xs text-fg-muted">
              {i === 0 ? "" : t(OP_LABEL_KEY[draft.op])}
            </span>
            <div className="min-w-0 flex-1">
              {isCodeRef(term) ? (
                <CodeRow term={term} tree={tree} onChange={(t) => setDraft(setTerm(draft, i, t))} />
              ) : (
                <GroupRow
                  group={term}
                  tree={tree}
                  onChange={(t) => setDraft(setTerm(draft, i, t))}
                />
              )}
            </div>
            <button
              className="mt-1 rounded p-0.5 text-fg-muted hover:bg-muted disabled:opacity-30"
              disabled={draft.terms.length <= minTerms(draft.op)}
              onClick={() => setDraft(removeTerm(draft, i))}
              aria-label={t("excerpts.query.removeRow", { row: i + 1 })}
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 text-xs">
        <button
          className="flex items-center gap-1 rounded border border-border-strong px-1.5 py-0.5 hover:bg-muted"
          onClick={() => setDraft(addTerm(draft, codeRef("")))}
          data-testid="add-query-code"
        >
          <Plus className="size-3" /> {t("excerpts.query.addCode")}
        </button>
        <button
          className="flex items-center gap-1 rounded border border-border-strong px-1.5 py-0.5 hover:bg-muted"
          onClick={() =>
            setDraft(addTerm(draft, { op: "or", terms: [codeRef(""), codeRef("")], within: null }))
          }
          data-testid="add-query-group"
        >
          <Plus className="size-3" /> {t("excerpts.query.addGroup")}
        </button>
      </div>
    </div>
  );
}

function OpSelect({ value, onChange }: { value: QueryOp; onChange: (op: QueryOp) => void }) {
  const { t } = useTranslation();
  return (
    <select
      className={cn(selectClass, "w-24")}
      value={value}
      onChange={(e) => onChange(e.target.value as QueryOp)}
      aria-label={t("excerpts.query.operator")}
      data-testid="query-op"
    >
      {QUERY_OPS.map((op) => (
        <option key={op} value={op}>
          {t(OP_LABEL_KEY[op])}
        </option>
      ))}
    </select>
  );
}

/** One code, with the same "include sub-codes" choice the filters offer. */
function CodeRow({
  term,
  tree,
  onChange,
}: {
  term: CodeRef;
  tree: ReturnType<typeof useCodeTree>;
  onChange: (t: QueryTerm) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <CodeSelect
        value={term.codeId}
        tree={tree}
        onChange={(codeId) => onChange({ ...term, codeId })}
      />
      <label
        className="flex shrink-0 items-center gap-1 text-xs text-fg-muted"
        title={t("excerpts.query.subcodesHint")}
      >
        <input
          type="checkbox"
          checked={term.includeDescendants}
          onChange={(e) => onChange({ ...term, includeDescendants: e.target.checked })}
        />
        {t("excerpts.query.subShort")}
      </label>
    </div>
  );
}

/** One level of nesting: a whole query as a row of the outer one. */
function GroupRow({
  group,
  tree,
  onChange,
}: {
  group: Query;
  tree: ReturnType<typeof useCodeTree>;
  onChange: (t: QueryTerm) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-1.5">
      <OpSelect value={group.op} onChange={(op) => onChange(setOp(group, op))} />
      {group.terms.map((term, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-8 shrink-0 text-right text-xs text-fg-muted">
            {i === 0 ? "" : t(OP_LABEL_KEY[group.op])}
          </span>
          <CodeSelect
            value={isCodeRef(term) ? term.codeId : ""}
            tree={tree}
            onChange={(codeId) =>
              onChange(
                setTerm(
                  group,
                  i,
                  codeRef(codeId, isCodeRef(term) ? term.includeDescendants : true),
                ),
              )
            }
          />
        </div>
      ))}
    </div>
  );
}

function CodeSelect({
  value,
  tree,
  onChange,
}: {
  value: string;
  tree: ReturnType<typeof useCodeTree>;
  onChange: (codeId: string) => void;
}) {
  const { t } = useTranslation();
  const nodes = flattenTree(tree);
  return (
    <select
      className={cn(selectClass, "min-w-0 flex-1")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("excerpts.query.code")}
      data-testid="query-code"
    >
      <option value="">{t("excerpts.query.chooseCode")}</option>
      {nodes.map((n) => (
        <option key={n.code.id} value={n.code.id} title={pathOf(tree, n.code.id)}>
          {" ".repeat(n.depth * 2) + n.code.name}
        </option>
      ))}
    </select>
  );
}
