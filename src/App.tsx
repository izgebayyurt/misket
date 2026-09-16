import { useProjectInfo } from "@/queries/project";
import { StartScreen } from "@/components/project/StartScreen";
import { Workspace } from "@/components/layout/Workspace";
import { Toaster } from "@/components/layout/Toaster";
import { useImportFiles } from "@/components/documents/useImportFiles";
import { TidyImportDialog } from "@/components/documents/TidyImportDialog";
import { useE2eBootstrap } from "@/components/project/useE2eBootstrap";
import { useOpenFileRequests } from "@/components/project/useOpenFileRequests";

export default function App() {
  const { data: project, isLoading } = useProjectInfo();
  const { importPaths } = useImportFiles();
  useE2eBootstrap(importPaths);
  useOpenFileRequests();
  return (
    <>
      {isLoading ? null : project ? <Workspace project={project} /> : <StartScreen />}
      <Toaster />
      <TidyImportDialog />
    </>
  );
}
