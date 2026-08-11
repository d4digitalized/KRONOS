import { redirectTimeOnlyMember, requireWsMember } from "@/lib/auth";
import ReportsView from "@/components/ReportsView";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  await redirectTimeOnlyMember(wsId);
  const { isAdmin } = await requireWsMember(wsId);
  return <ReportsView wsId={wsId} isAdmin={isAdmin} />;
}
