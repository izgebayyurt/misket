import { useRef, useState } from "react";
import { useRenameDocument } from "@/queries/documents";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

interface Props {
  documentId: string;
  name: string;
  /** Whether the title is currently an input; owned by the viewer so F2 can start it. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Typography for the heading; the input matches it so nothing jumps. */
  className?: string;
}

/**
 * The open document's title, editable in place: double-click it (or press F2
 * in the viewer) to turn it into an input. Enter and blur save through the
 * usual rename mutation, Escape cancels.
 */
export function DocumentTitle({ documentId, name, editing, onEditingChange, className }: Props) {
  const rename = useRenameDocument();

  function commit(next: string) {
    onEditingChange(false);
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    rename.mutateAsync({ id: documentId, name: trimmed }).catch(toast.error);
  }

  if (editing) {
    return (
      <TitleInput
        // A fresh input per edit, so it always starts from the stored name.
        key={name}
        initial={name}
        className={className}
        onCommit={commit}
        onCancel={() => onEditingChange(false)}
      />
    );
  }

  return (
    <h1
      className={className}
      onDoubleClick={() => onEditingChange(true)}
      title="Double-click to rename (F2)"
      data-testid="document-title"
    >
      {name}
    </h1>
  );
}

interface TitleInputProps {
  initial: string;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function TitleInput({ initial, className, onCommit, onCancel }: TitleInputProps) {
  const [value, setValue] = useState(initial);
  // Enter saves and then blurs; without this the blur would save a second time.
  const settled = useRef(false);

  function finish(save: boolean) {
    if (settled.current) return;
    settled.current = true;
    if (save) onCommit(value);
    else onCancel();
  }

  return (
    <input
      autoFocus
      value={value}
      aria-label="Document name"
      data-testid="document-title-input"
      className={cn(
        className,
        "w-full rounded-md border border-border bg-panel px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-focus",
      )}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}
