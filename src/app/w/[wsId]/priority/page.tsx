import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import PriorityListView from "@/components/PriorityListView";

export default async function PriorityPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  await redirectTimeOnlyMember(wsId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <PriorityListView wsId={wsId} userId={user.id} />;
}
