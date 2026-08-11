import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import NotesView from "@/components/NotesView";

export default async function NotesPage({
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

  // funkci musí mít odemčenou admin (flag can_notes); jinak zpět na Priority list
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("can_notes")
    .eq("workspace_id", wsId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership?.can_notes) redirect(`/w/${wsId}/priority`);

  return <NotesView wsId={wsId} userId={user.id} />;
}
