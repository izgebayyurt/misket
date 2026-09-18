import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useToasts, type Toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

/**
 * One toast. A keyed toast stays put when it is raised again; the repeat
 * arrives as a bumped `nudge`, which replays the flash-and-shake animation
 * (see `.toast-nudge` in `globals.css`, which reduces to a flash alone when
 * the system asks for less motion).
 */
function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (toast.nudge === 0) return;
    const el = ref.current;
    if (!el) return;
    el.classList.remove("toast-nudge");
    // Force a reflow so the animation restarts on every repeat, not just the
    // first: without it the browser sees the class as never having changed.
    void el.offsetWidth;
    el.classList.add("toast-nudge");
  }, [toast.nudge]);
  return (
    <div
      ref={ref}
      // "alert" carries an implicit assertive, atomic live region, so an
      // error interrupts; "status" (polite, atomic) queues behind whatever
      // the screen reader is already saying.
      role={toast.kind === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg",
        toast.kind === "error" ? "border-danger/50 text-danger" : "border-border",
      )}
      data-testid="toast"
      data-nudge={toast.nudge || undefined}
    >
      <span className="flex-1 break-words">{toast.message}</span>
      {toast.nudge > 0 ? (
        <span
          className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-fg-muted"
          title={`Said ${toast.nudge + 1} times`}
          data-testid="toast-repeat-count"
        >
          ×{toast.nudge + 1}
        </span>
      ) : null}
      <button
        onClick={onDismiss}
        className="rounded p-0.5 text-fg-muted hover:bg-muted"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
