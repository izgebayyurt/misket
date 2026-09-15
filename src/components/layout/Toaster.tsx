import { X } from "lucide-react";
import { useToasts } from "@/state/toasts";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border bg-panel px-3 py-2 text-sm shadow-lg",
            t.kind === "error" ? "border-danger/50 text-danger" : "border-border",
          )}
        >
          <span className="flex-1 break-words">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="rounded p-0.5 text-fg-muted hover:bg-muted"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
