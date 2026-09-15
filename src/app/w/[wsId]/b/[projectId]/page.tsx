import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import BoardView from "@/components/BoardView";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ wsId: string; projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { wsId, projectId } = await params;
  const supabase = await createClient();
  // kontext firmy i projekt najednou — projekt hlídá RLS, není na co čekat
  const [{ user, isAdmin }, { data: project }, { task: initialTaskId }] =
    await Promise.all([
      redirectTimeOnlyMember(wsId),
      supabase
        .from("projects")
        .select("id, name, workspace_id")
        .eq("id", projectId)
        .eq("workspace_id", wsId)
        .maybeSingle(),
      searchParams,
    ]);
  if (!project) notFound();

  return (
    <BoardView
      wsId={wsId}
      projectId={projectId}
      projectName={project.name}
      userId={user.id}
      isAdmin={isAdmin}
      initialTaskId={initialTaskId}
    />
  );
}
