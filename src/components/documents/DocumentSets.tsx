import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDocuments } from "@/queries/documents";
import { useWorkspace } from "@/state/workspace";
import { SetsSection } from "@/components/sets/SetsSection";
import type { MemberOption } from "@/components/sets/SetDialog";

/** Document sets, listed under the document list. */
export function DocumentSets() {
  const { t } = useTranslation();
  const { data: docs } = useDocuments();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const options = useMemo<MemberOption[]>(
    () => (docs ?? []).map((d) => ({ id: d.id, label: d.name })),
    [docs],
  );
  return (
    <SetsSection
      kind="document"
      title={t("documents.setsTitle")}
      options={options}
      onOpen={(s) => openExcerpts({ documentSetIds: [s.id] })}
    />
  );
}
