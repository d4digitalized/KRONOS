import { redirectTimeOnlyMember } from "@/lib/auth";
import MyDayView from "@/components/MyDayView";

export default async function MyDayPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user } = await redirectTimeOnlyMember(wsId);

  return <MyDayView wsId={wsId} userId={user.id} />;
}
