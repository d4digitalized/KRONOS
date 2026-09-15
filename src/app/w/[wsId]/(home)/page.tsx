import { redirectTimeOnlyMember } from "@/lib/auth";
import BoardsList from "@/components/BoardsList";

export default async function BoardsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { isAdmin } = await redirectTimeOnlyMember(wsId);

  return <BoardsList wsId={wsId} isAdmin={isAdmin} />;
}
