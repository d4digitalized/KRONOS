import { requireWsAdmin } from "@/lib/auth";
import ReportsView from "@/components/ReportsView";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  await requireWsAdmin(wsId);
  return <ReportsView wsId={wsId} />;
}
