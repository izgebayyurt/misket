import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
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

const LEVEL_OPTIONS: { value: LevelFilter; labelKey: string }[] = [
  { value: "all", labelKey: "layout.logs.levelAll" },
  { value: "info", labelKey: "layout.logs.levelInfo" },
  { value: "warn", labelKey: "layout.logs.levelWarnings" },
  { value: "error", labelKey: "layout.logs.levelErrors" },
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
  const { t } = useTranslation();
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
      toast.info(t("layout.logs.copiedToClipboard"));
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
      toast.info(t("layout.logs.logsCleared"));
      await qc.invalidateQueries({ queryKey: LOGS_QUERY_KEY });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("layout.logs.title")}
        description={t("layout.logs.description")}
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
              {t("layout.logs.revealInFolder")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-label={t("layout.logs.levelGroupLabel")}
            >
              {LEVEL_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={level === o.value ? "default" : "outline"}
                  role="radio"
                  aria-checked={level === o.value}
                  onClick={() => setLevel(o.value)}
                >
                  {t(o.labelKey)}
                </Button>
              ))}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("layout.logs.searchPlaceholder")}
              className="min-w-0 flex-1"
              data-testid="log-search"
            />
          </div>

          <div
            className="h-80 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-xs"
            data-testid="log-lines"
          >
            {isLoading ? (
              <p className="text-fg-muted">{t("common.loading")}</p>
            ) : filtered.length === 0 ? (
              <p className="text-fg-muted">
                {parsed.length === 0
                  ? t("layout.logs.nothingLoggedYet")
                  : t("layout.logs.noLinesMatch")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((line, i) => (
                  <li
                    key={i}
                    className={
                      line.level === "error"
                        ? "text-danger"
                        : line.level === "warn"
                          ? "text-warn"
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
            {t("layout.logs.clearLogs")}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyVisible()}>
              {t("common.copy")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              {t("common.refresh")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      {confirmClear ? (
        <ConfirmDialog
          title={t("layout.logs.clearLogsConfirmTitle")}
          description={t("layout.logs.clearLogsConfirmDescription")}
          confirmLabel={t("common.clear")}
          onConfirm={() => void confirmClearLogs()}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </Dialog>
  );
}
