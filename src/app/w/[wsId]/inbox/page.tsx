import { redirectTimeOnlyMember } from "@/lib/auth";
import InboxView from "@/components/InboxView";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user, canDelegate } = await redirectTimeOnlyMember(wsId);

  return <InboxView wsId={wsId} userId={user.id} canDelegate={canDelegate} />;
}
