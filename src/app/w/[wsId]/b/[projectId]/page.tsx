import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BoardView from "@/components/BoardView";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ wsId: string; projectId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { wsId, projectId } = await params;
  const { task: initialTaskId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: project }, { data: profile }, { data: membership }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, workspace_id")
        .eq("id", projectId)
        .eq("workspace_id", wsId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("id", user!.id)
        .single(),
      supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", wsId)
        .eq("user_id", user!.id)
        .maybeSingle(),
    ]);
  if (!project) notFound();

  const isAdmin =
    (profile?.is_super_admin ?? false) || membership?.role === "admin";

  return (
    <BoardView
      wsId={wsId}
      projectId={projectId}
      projectName={project.name}
      userId={user!.id}
      isAdmin={isAdmin}
      initialTaskId={initialTaskId}
    />
  );
}
