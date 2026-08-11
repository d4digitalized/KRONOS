import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import BoardsList from "@/components/BoardsList";

export default async function BoardsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  await redirectTimeOnlyMember(wsId);
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_ws_admin", { ws: wsId });

  return <BoardsList wsId={wsId} isAdmin={!!isAdmin} />;
}
