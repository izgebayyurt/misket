import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearLogs, readLogs } from "@/api/diagnostics";
import { toast } from "@/state/toasts";

/** Not in `queries/keys.ts`: nothing else invalidates this, it is only ever
 * refetched from this dialog itself. */
const LOGS_QUERY_KEY = ["diagnostics", "logs"] as const;

type LevelFilter = "all" | "info" | "warn" | "error";

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors" },
];

interface ParsedLine {
  raw: string;
  level: string;
  message: string;
}

/** Lines are JSON (see `src-tauri/src/logging.rs`); a line that fails to
 * parse (a partial write, or something unexpected) still shows, as-is. */
function parseLine(raw: string): ParsedLine {
  try {
    const obj = JSON.parse(raw) as {
      level?: string;
      fields?: { message?: string };
    };
    return {
      raw,
      level: (obj.level ?? "info").toLowerCase(),
      message: obj.fields?.message ?? raw,
    };
  } catch {
    return { raw, level: "info", message: raw };
  }
}

export function LogViewerDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({ queryKey: LOGS_QUERY_KEY, queryFn: readLogs });
  const clear = useMutation({ mutationFn: clearLogs });
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const parsed = useMemo(() => (data?.lines ?? []).map(parseLine), [data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return parsed.filter((line) => {
      if (level !== "all" && line.level !== level) return false;
      if (needle && !line.raw.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [parsed, level, search]);

  async function copyVisible() {
    try {
      await navigator.clipboard.writeText(filtered.map((l) => l.raw).join("\n"));
      toast.info("Copied to clipboard");
    } catch (e) {
      toast.error(e);
    }
  }

  async function reveal() {
    const target = data?.file ?? data?.dir;
    if (!target) return;
    try {
      await revealItemInDir(target);
    } catch (e) {
      toast.error(e);
    }
  }

  async function confirmClearLogs() {
    setConfirmClear(false);
    try {
      await clear.mutateAsync();
      toast.info("Logs cleared");
      await qc.invalidateQueries({ queryKey: LOGS_QUERY_KEY });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Logs"
        description="Kept for 7 days, on this computer only. Nothing here is sent anywhere unless you turn on crash reporting below and send a report."
        className="max-w-2xl"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={data?.dir ?? ""}
              className="min-w-0 flex-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
              data-testid="log-dir"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reveal()}
              disabled={!data?.dir}
            >
              Reveal in folder
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="radiogroup" aria-label="Level">
              {LEVEL_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={level === o.value ? "default" : "outline"}
                  aria-pressed={level === o.value}
                  onClick={() => setLevel(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="min-w-0 flex-1"
              data-testid="log-search"
            />
          </div>

          <div
            className="h-80 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-xs"
            data-testid="log-lines"
          >
            {isLoading ? (
              <p className="text-fg-muted">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-fg-muted">
                {parsed.length === 0 ? "Nothing logged yet." : "No lines match."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((line, i) => (
                  <li
                    key={i}
                    className={
                      line.level === "error"
                        ? "text-red-500"
                        : line.level === "warn"
                          ? "text-amber-500"
                          : undefined
                    }
                  >
                    {line.raw}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
            Clear logs
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyVisible()}>
              Copy
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Refresh
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      {confirmClear ? (
        <ConfirmDialog
          title="Clear logs?"
          description="Deletes every log file on this computer. This cannot be undone."
          confirmLabel="Clear"
          onConfirm={() => void confirmClearLogs()}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </Dialog>
  );
}
