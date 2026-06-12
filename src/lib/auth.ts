import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireWsAdmin(wsId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin } = await supabase.rpc("is_ws_admin", { ws: wsId });
  if (!isAdmin) redirect(`/w/${wsId}`);
  return user;
}

export async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_super_admin) redirect("/");
  return user;
}
