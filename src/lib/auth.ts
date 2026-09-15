import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getWsContext, type SessionUser } from "@/lib/session";

// Všechny helpery stojí nad getWsContext() — kontext firmy se v rámci
// jednoho požadavku počítá jednou a sdílí ho layout i stránka.

export async function requireWsAdmin(wsId: string): Promise<SessionUser> {
  const ctx = await getWsContext(wsId);
  if (!ctx) redirect("/login");
  if (!ctx.isAdmin) redirect(`/w/${wsId}`);
  return ctx.user;
}

/** Pustí kteréhokoli člena workspace; vrací i příznak, zda je admin,
    aby stránka mohla omezit rozsah/akce běžnému uživateli. */
export async function requireWsMember(wsId: string) {
  const ctx = await getWsContext(wsId);
  if (!ctx) redirect("/login");
  if (!ctx.isMember) redirect("/");
  return { user: ctx.user, isAdmin: ctx.isAdmin };
}

/** Člen „jen měření času" (time_only) patří na /time — obsahové stránky
    firmy ho tam přesměrují. Adminům se flag ignoruje. Volat na začátku
    každé /w/[wsId]/* stránky kromě /time. Vrací celý kontext firmy, ať
    stránka nemusí nic dalšího dotahovat. */
export async function redirectTimeOnlyMember(wsId: string) {
  const ctx = await getWsContext(wsId);
  if (!ctx) redirect("/login");
  if (ctx.timeOnly) redirect(`/w/${wsId}/time`);
  return ctx;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_super_admin) redirect("/");
  return user;
}
