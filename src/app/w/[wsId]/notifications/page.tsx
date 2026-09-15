import { redirectTimeOnlyMember } from "@/lib/auth";
import NotificationsView from "@/components/NotificationsView";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params; // layout ověřuje workspace; notifikace jsou osobní
  const { user } = await redirectTimeOnlyMember(wsId);

  return <NotificationsView userId={user.id} />;
}
