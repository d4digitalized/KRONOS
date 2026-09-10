import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Nastavení žije uvnitř firmy (/w/<id>/settings), aby mělo postranní panel
// a mobilní navigaci jako zbytek aplikace. Stará adresa (odkazy v e-mailech)
// přesměruje do první firmy uživatele.
export default async function SettingsRedirect() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  const wsId = memberships?.[0]?.workspace_id;
  redirect(wsId ? `/w/${wsId}/settings` : "/");
}
