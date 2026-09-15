import { redirect } from "next/navigation";
import { redirectTimeOnlyMember } from "@/lib/auth";
import TasksView from "@/components/TasksView";

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ wsId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { wsId } = await params;
  const [{ user, isAdmin, canTaskforce }, { task: initialTaskId }] =
    await Promise.all([redirectTimeOnlyMember(wsId), searchParams]);

  // Task force vidí jen ten, kdo může zadávat i jiným (admin / grant)
  if (!canTaskforce) redirect(`/w/${wsId}/my`);

  return (
    <TasksView
      wsId={wsId}
      userId={user.id}
      isAdmin={isAdmin}
      initialTaskId={initialTaskId}
    />
  );
}
