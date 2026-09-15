import { redirectTimeOnlyMember } from "@/lib/auth";
import PriorityListView from "@/components/PriorityListView";

export default async function PriorityPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user } = await redirectTimeOnlyMember(wsId);

  return <PriorityListView wsId={wsId} userId={user.id} />;
}
