import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A small "chip" button that opens a searchable checkbox list, with a clear
 * button once the filter is active. Shared by the excerpt browser and the
 * analysis views; `children` receives the current search query.
 */
export function FilterPicker({
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
              "flex items-center gap-1 rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-muted",
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
