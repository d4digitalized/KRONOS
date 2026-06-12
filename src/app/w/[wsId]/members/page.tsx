import { requireWsAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import MembersView from "@/components/MembersView";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const user = await requireWsAdmin(wsId);

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  return (
    <MembersView
      wsId={wsId}
      currentUserId={user.id}
      isSuperAdmin={profile?.is_super_admin ?? false}
    />
  );
}
