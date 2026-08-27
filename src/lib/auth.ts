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

/** Pustí kteréhokoli člena workspace; vrací i příznak, zda je admin,
    aby stránka mohla omezit rozsah/akce běžnému uživateli. */
export async function requireWsMember(wsId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isMember } = await supabase.rpc("is_ws_member", { ws: wsId });
  if (!isMember) redirect("/");

  const { data: isAdmin } = await supabase.rpc("is_ws_admin", { ws: wsId });
  return { user, isAdmin: !!isAdmin };
}

/** Člen „jen měření času" (time_only) patří na /time — obsahové stránky
    firmy ho tam přesměrují. Adminům se flag ignoruje. Volat na začátku
    každé /w/[wsId]/* stránky kromě /time. */
export async function redirectTimeOnlyMember(wsId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("is_super_admin").eq("id", user.id).single(),
    supabase
      .from("workspace_members")
      .select("role, time_only, percent_report")
      .eq("workspace_id", wsId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const isAdmin = (profile?.is_super_admin ?? false) || membership?.role === "admin";
  if (!isAdmin && (membership?.time_only || membership?.percent_report))
    redirect(`/w/${wsId}/time`);
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
