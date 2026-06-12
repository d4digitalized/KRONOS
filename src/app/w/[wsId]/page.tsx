import { createClient } from "@/lib/supabase/server";
import TasksView from "@/components/TasksView";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <TasksView wsId={wsId} userId={user!.id} />;
}
