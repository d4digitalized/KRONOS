import { redirect } from "next/navigation";
import { redirectTimeOnlyMember } from "@/lib/auth";
import ReportsView from "@/components/ReportsView";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user, isAdmin, isMember } = await redirectTimeOnlyMember(wsId);
  if (!isMember) redirect("/");
  return <ReportsView wsId={wsId} userId={user.id} isAdmin={isAdmin} />;
}
