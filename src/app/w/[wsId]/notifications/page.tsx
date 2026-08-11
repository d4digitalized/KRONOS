import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import NotificationsView from "@/components/NotificationsView";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params; // layout ověřuje workspace; notifikace jsou osobní
  await redirectTimeOnlyMember(wsId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <NotificationsView userId={user.id} />;
}
