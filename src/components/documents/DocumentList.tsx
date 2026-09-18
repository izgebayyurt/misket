import { describe } from "@/core/keymap";
import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Film,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  MoreHorizontal,
  Upload,
} from "lucide-react";
import { useDeleteDocument, useDocuments, useRenameDocument } from "@/queries/documents";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  contextMenuPrimitives,
  dropdownMenuPrimitives,
  type MenuPrimitives,
} from "@/components/ui/menu";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useImportFiles } from "./useImportFiles";
import { useRelinkMedia } from "./useRelinkMedia";
import { ImportFolderDialog } from "./ImportFolderDialog";
import { DocumentSets } from "./DocumentSets";
import { AddToSetMenu } from "@/components/sets/AddToSetMenu";
import { toast } from "@/state/toasts";
import type { DocumentSummary } from "@/api/types";

export function DocumentList() {
  const { data: docs } = useDocuments();
  const view = useWorkspace((s) => s.view);
  const openDocument = useWorkspace((s) => s.openDocument);
  const { pickAndImport, pickFolder, isPending } = useImportFiles();
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);
  const [folder, setFolder] = useState<string | null>(null);

  async function chooseFolder() {
    const dir = await pickFolder();
    if (dir) setFolder(dir);
  }

  return (
    <div className="flex flex-col">
      <div className="flex gap-1 p-2">
        <Button
          variant="outline"
          className="min-w-0 flex-1 justify-start"
          onClick={pickAndImport}
          disabled={isPending}
          data-testid="import-documents"
        >
          <Upload /> Import…
          <span className="ml-auto text-xs text-fg-muted">{describe("import")}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="More import options"
              data-testid="import-menu"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void pickAndImport()}>
              <Upload /> Import files…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void chooseFolder()} data-testid="import-folder">
              <FolderOpen /> Import folder…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {docs && docs.length === 0 ? (
        <p className="px-3 py-2 text-xs text-fg-muted">
          No documents yet. Import txt, md, docx, pdf, images, audio or video.
        </p>
      ) : null}
      <ul>
        {docs?.map((d) => {
          const active = view.kind === "document" && view.documentId === d.id;
          return (
            <li key={d.id} className="group">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted",
                      active && "bg-muted font-medium",
                    )}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        openDocument(d.id);
                      }}
                      data-testid="document-item"
                    >
                      {d.kind === "image" ? (
                        <ImageIcon className="size-4 shrink-0 text-fg-muted" />
                      ) : d.kind === "video" ? (
                        <Film className="size-4 shrink-0 text-fg-muted" />
                      ) : (
                        <FileText className="size-4 shrink-0 text-fg-muted" />
                      )}
                      <span className="truncate">{d.name}</span>
                      {d.mediaMissing ? (
                        <AlertTriangle
                          className="size-3.5 shrink-0 text-danger"
                          aria-label="Its file is missing"
                          data-testid="document-media-missing"
                        />
                      ) : null}
                      {d.sourceFormat ? (
                        <span
                          className="shrink-0 rounded border border-border px-1 text-[10px] uppercase text-fg-muted"
                          title={
                            d.sourceFormat === "pdf-ocr"
                              ? "Text recognised from a scanned PDF with OCR"
                              : undefined
                          }
                        >
                          {formatBadgeLabel(d.sourceFormat)}
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs text-fg-muted">
                        {d.excerptCount || ""}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label="Document actions"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DocumentRowMenuItems
                          doc={d}
                          onRename={() => setRenaming(d)}
                          onDelete={() => setDeleting(d)}
                          menu={dropdownMenuPrimitives}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <DocumentRowMenuItems
                    doc={d}
                    onRename={() => setRenaming(d)}
                    onDelete={() => setDeleting(d)}
                    menu={contextMenuPrimitives}
                  />
                </ContextMenuContent>
              </ContextMenu>
            </li>
          );
        })}
      </ul>
      <DocumentSets />
      {renaming ? <RenameDialog doc={renaming} onClose={() => setRenaming(null)} /> : null}
      {deleting ? <DeleteDialog doc={deleting} onClose={() => setDeleting(null)} /> : null}
      {folder ? <ImportFolderDialog dir={folder} onClose={() => setFolder(null)} /> : null}
    </div>
  );
}

/** A document row's action list, shared by its "…" button menu and its right-click menu. */
function DocumentRowMenuItems({
  doc,
  onRename,
  onDelete,
  menu,
}: {
  doc: DocumentSummary;
  onRename: () => void;
  onDelete: () => void;
  menu: MenuPrimitives;
}) {
  const { Item } = menu;
  const relink = useRelinkMedia();
  return (
    <>
      <Item onSelect={onRename}>Rename…</Item>
      {doc.kind === "video" ? (
        <Item onSelect={() => void relink.pickAndRelink(doc.id)}>
          {doc.mediaMissing ? "Relink the missing file…" : "Relink…"}
        </Item>
      ) : null}
      <AddToSetMenu kind="document" memberId={doc.id} memberLabel={doc.name} menu={menu} />
      <Item danger onSelect={onDelete}>
        Delete…
      </Item>
    </>
  );
}

function RenameDialog({ doc, onClose }: { doc: DocumentSummary; onClose: () => void }) {
  const [name, setName] = useState(doc.name);
  const rename = useRenameDocument();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Rename document">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await rename.mutateAsync({ id: doc.id, name });
              onClose();
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `sourceFormat` values that need a friendlier badge than their raw string. */
function formatBadgeLabel(sourceFormat: string): string {
  return sourceFormat === "pdf-ocr" ? "OCR" : sourceFormat;
}

function DeleteDialog({ doc, onClose }: { doc: DocumentSummary; onClose: () => void }) {
  const del = useDeleteDocument();
  const view = useWorkspace((s) => s.view);
  const setView = useWorkspace((s) => s.setView);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Delete "${doc.name}"?`}
        description={
          doc.excerptCount > 0
            ? `This also deletes its ${doc.excerptCount} excerpt${doc.excerptCount === 1 ? "" : "s"} and their memos. You can undo this from History.`
            : "You can undo this from History."
        }
      >
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await del.mutateAsync(doc.id);
                if (view.kind === "document" && view.documentId === doc.id)
                  setView({ kind: "empty" });
                onClose();
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
