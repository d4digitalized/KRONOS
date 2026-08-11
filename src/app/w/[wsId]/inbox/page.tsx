import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import InboxView from "@/components/InboxView";

export default async function InboxPage({
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

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("is_super_admin").eq("id", user.id).single(),
    supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", wsId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isAdmin = !!profile?.is_super_admin || membership?.role === "admin";
  const canDelegate = isAdmin || !!membership?.can_delegate;

  return <InboxView wsId={wsId} userId={user.id} canDelegate={canDelegate} />;
}
