import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalysisTab } from "@/state/workspace";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { ANALYSES, ANALYSIS_GROUPS, analysisEntry } from "./registry";

const COLLAPSED_KEY = "misket:analysisNavCollapsed";

/** Best effort: blocked or full storage just means the list forgets. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The analysis workbench: a list of analyses down the left, the chosen one
 * filling the rest.
 *
 * This used to be a row of tabs across the top, which ran out of room at six
 * and left nowhere obvious for the seventh. The list grows downward instead,
 * gathers related analyses under small headings, and collapses to icons when
 * the analysis itself needs the width. Each analysis keeps its own toolbar:
 * the document, set and coder filters stay in the content header, next to the
 * numbers they narrow.
 */
export function AnalysisView({ tab }: { tab: AnalysisTab }) {
  const { t } = useTranslation();
  const setView = useWorkspace((s) => s.setView);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const entry = analysisEntry(tab);
  const Body = entry.component;

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Not worth telling anyone about.
    }
  }, [collapsed]);

  return (
    <div className="flex h-full min-h-0" data-testid="analysis-view">
      <nav
        className={cn(
          "flex shrink-0 flex-col overflow-y-auto border-r border-border bg-panel",
          collapsed ? "w-12" : "w-48",
        )}
        aria-label={t("analysis.title")}
        data-testid="analysis-nav"
        data-collapsed={collapsed || undefined}
      >
        <div
          className={cn(
            "flex items-center gap-1 border-b border-border px-2 py-2",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? null : (
            <h2 className="min-w-0 flex-1 truncate font-serif text-base font-medium">
              {t("analysis.title")}
            </h2>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
            title={collapsed ? t("analysis.showNames") : t("analysis.collapseToIcons")}
            aria-label={collapsed ? t("analysis.showNames") : t("analysis.collapseToIcons")}
            data-testid="analysis-nav-collapse"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>
        <ul className="min-h-0 flex-1 py-1">
          {ANALYSIS_GROUPS.map((group) => {
            const items = ANALYSES.filter((a) => a.group === group.id);
            if (items.length === 0) return null;
            return (
              <li key={group.id}>
                {collapsed ? (
                  <div className="mx-2 my-1 border-t border-border" aria-hidden />
                ) : (
                  <h3 className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                    {t(group.labelKey)}
                  </h3>
                )}
                <ul>
                  {items.map((a) => {
                    const Icon = a.icon;
                    const selected = a.id === entry.id;
                    const label = t(a.labelKey);
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setView({ kind: "analysis", tab: a.id })}
                          aria-current={selected ? "true" : undefined}
                          title={collapsed ? label : undefined}
                          className={cn(
                            "flex w-full items-center gap-2 border-l-2 border-transparent py-1.5 text-left text-sm text-fg-muted hover:bg-muted hover:text-fg",
                            collapsed ? "justify-center px-0" : "px-3",
                            selected && "border-accent bg-muted/70 font-medium text-fg",
                          )}
                          data-testid={`analysis-tab-${a.id}`}
                        >
                          <Icon className="size-4 shrink-0" />
                          {collapsed ? (
                            <span className="sr-only">{label}</span>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate">{label}</span>
                              {a.shortcut ? (
                                <span className="shrink-0 text-[10px] text-fg-muted">
                                  {a.shortcut}
                                </span>
                              ) : null}
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="analysis-body">
        {/* Remount when the analysis changes: each one holds its own filters
            and sort, and none of them means anything to the next. */}
        <Body key={entry.id} />
      </div>
    </div>
  );
}
