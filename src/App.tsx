import { useProjectInfo } from "@/queries/project";
import { StartScreen } from "@/components/project/StartScreen";
import { Workspace } from "@/components/layout/Workspace";
import { Toaster } from "@/components/layout/Toaster";

export default function App() {
  const { data: project, isLoading } = useProjectInfo();
  return (
    <>
      {isLoading ? null : project ? <Workspace project={project} /> : <StartScreen />}
      <Toaster />
    </>
  );
}
