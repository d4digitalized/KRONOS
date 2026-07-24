import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Sdílený odkaz na úkol: /t/<id> dohledá úkol (RLS hlídá přístup) a
// přesměruje na nástěnku projektu (resp. seznam úkolů u úkolů bez
// projektu) s kartou otevřenou přes ?task=.
export default async function TaskLinkPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: task } = await supabase
    .from("tasks")
    .select("id, workspace_id, project_id, parent_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) notFound();

  // u podúkolu otevíráme rodičovskou kartu (podúkoly žijí v modalu rodiče)
  const targetId = task.parent_id ?? task.id;

  if (task.project_id) {
    redirect(`/w/${task.workspace_id}/b/${task.project_id}?task=${targetId}`);
  }
  redirect(`/w/${task.workspace_id}/tasks?task=${targetId}`);
}
