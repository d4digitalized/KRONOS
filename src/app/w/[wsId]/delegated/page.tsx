import { redirectTimeOnlyMember } from "@/lib/auth";
import DelegatedView from "@/components/DelegatedView";

export default async function DelegatedPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user } = await redirectTimeOnlyMember(wsId);

  return <DelegatedView wsId={wsId} userId={user.id} />;
}
