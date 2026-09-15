import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useCodeTree } from "@/queries/codes";
import { useDocuments } from "@/queries/documents";
import { flattenTree, pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  codeIds: string[];
  onCodeIds: (v: string[]) => void;
  includeDescendants: boolean;
  onIncludeDescendants: (v: boolean) => void;
  documentIds: string[];
  onDocumentIds: (v: string[]) => void;
  uncodedOnly: boolean;
  onUncodedOnly: (v: boolean) => void;
  total: number;
}

export function ExcerptFilters(p: Props) {
  const tree = useCodeTree();
  const { data: docs } = useDocuments();
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2 text-sm">
      <h2 className="mr-2 font-serif text-lg font-medium">Excerpts</h2>
      <FilterPicker
        label={
          p.codeIds.length
            ? `${p.codeIds.length} code${p.codeIds.length > 1 ? "s" : ""}`
            : "Any code"
        }
        active={p.codeIds.length > 0}
        onClear={() => p.onCodeIds([])}
        testId="filter-codes"
      >
        {(query) => (
          <>
            <label className="mb-1 flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={p.includeDescendants}
                onChange={(e) => p.onIncludeDescendants(e.target.checked)}
              />
              Include sub-codes
            </label>
            {flattenTree(tree)
              .filter((n) => pathOf(tree, n.code.id).toLowerCase().includes(query.toLowerCase()))
              .map((n) => (
                <label
                  key={n.code.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                  style={{ paddingLeft: 8 + n.depth * 12 }}
                >
                  <input
                    type="checkbox"
                    checked={p.codeIds.includes(n.code.id)}
                    onChange={() => p.onCodeIds(toggle(p.codeIds, n.code.id))}
                  />
                  <ColorDot color={n.code.color} />
                  <span className="truncate">{n.code.name}</span>
                </label>
              ))}
          </>
        )}
      </FilterPicker>
      <FilterPicker
        label={
          p.documentIds.length
            ? `${p.documentIds.length} document${p.documentIds.length > 1 ? "s" : ""}`
            : "Any document"
        }
        active={p.documentIds.length > 0}
        onClear={() => p.onDocumentIds([])}
        testId="filter-documents"
      >
        {(query) => (
          <>
            {docs
              ?.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
              .map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={p.documentIds.includes(d.id)}
                    onChange={() => p.onDocumentIds(toggle(p.documentIds, d.id))}
                  />
                  <span className="truncate">{d.name}</span>
                </label>
              ))}
          </>
        )}
      </FilterPicker>
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={p.uncodedOnly}
          onChange={(e) => p.onUncodedOnly(e.target.checked)}
        />
        Uncoded only
      </label>
      <span className="ml-auto text-xs text-fg-muted" data-testid="excerpt-total">
        {p.total} excerpt{p.total === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function FilterPicker({
  label,
  active,
  onClear,
  children,
  testId,
}: {
  label: string;
  active: boolean;
  onClear: () => void;
  children: (query: string) => React.ReactNode;
  testId: string;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="flex items-center">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted",
              active && "border-accent bg-accent/10 text-fg",
            )}
            data-testid={testId}
          >
            {label} <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1">
          <Input
            placeholder="Filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-1 h-7 text-xs"
          />
          <div className="max-h-64 overflow-y-auto text-sm">{children(query)}</div>
        </PopoverContent>
      </Popover>
      {active ? (
        <button
          className="ml-0.5 rounded p-0.5 text-fg-muted hover:bg-muted"
          onClick={onClear}
          aria-label="Clear"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
