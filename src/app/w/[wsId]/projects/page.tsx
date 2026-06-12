import { requireWsAdmin } from "@/lib/auth";
import ProjectsView from "@/components/ProjectsView";

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  await requireWsAdmin(wsId);
  return <ProjectsView wsId={wsId} />;
}
