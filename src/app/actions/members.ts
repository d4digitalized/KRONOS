"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/types";

const INVITE_ERROR =
  "Pozvánkový e-mail se nepodařilo odeslat. Bez vlastního SMTP posílá Supabase max. ~2 e-maily za hodinu — zkus to později, nebo nastav SMTP (Resend) podle README.";

/** Najde účet podle e-mailu; když neexistuje, pošle pozvánku a účet založí. */
async function resolveOrInviteUser(
  normalized: string
): Promise<{ userId?: string; invited: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();
  if (existing?.id) return { userId: existing.id as string, invited: false };

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
    redirectTo: `${site}/auth/confirm`,
  });
  if (error || !data.user) return { invited: true, error: INVITE_ERROR };
  return { userId: data.user.id, invited: true };
}

/** Uživatelé portálu, kteří zatím nejsou členy daného workspace. Jen pro adminy WS. */
export async function listAddablePortalUsers(wsId: string): Promise<{
  users?: { id: string; email: string; full_name: string }[];
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };

  const { data: isAdmin } = await supabase.rpc("is_ws_admin", { ws: wsId });
  if (!isAdmin) return { error: "Nemáš oprávnění." };

  const admin = createAdminClient();
  const [{ data: profiles }, { data: members }] = await Promise.all([
    admin.from("profiles").select("id, email, full_name").order("full_name"),
    admin.from("workspace_members").select("user_id").eq("workspace_id", wsId),
  ]);

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const users = (profiles ?? [])
    .filter((p) => !memberIds.has(p.id))
    .map((p) => ({ id: p.id, email: p.email, full_name: p.full_name }));
  return { users };
}

export async function inviteMember(
  wsId: string,
  email: string,
  role: Role
): Promise<{ ok?: true; invited?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };

  const { data: isAdmin } = await supabase.rpc("is_ws_admin", { ws: wsId });
  if (!isAdmin) return { error: "Na pozvánky nemáš oprávnění." };

  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { error: "Neplatný e-mail." };

  const resolved = await resolveOrInviteUser(normalized);
  if (resolved.error || !resolved.userId) return { error: resolved.error };

  // membership přes user-scoped klienta — RLS vynutí, že admina smí přidat jen super-admin
  const { error: insertError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: wsId, user_id: resolved.userId, role });

  if (insertError) {
    if (insertError.code === "23505") return { error: "Už je členem workspace." };
    return { error: "Přidání se nezdařilo. Admina může jmenovat jen super-admin." };
  }
  return { ok: true, invited: resolved.invited };
}

/** Super-admin: přidá (případně nejdřív pozve) uživatele do více workspaces najednou. */
export async function inviteToWorkspaces(
  email: string,
  role: Role,
  wsIds: string[]
): Promise<{
  ok?: true;
  invited?: boolean;
  added?: number;
  alreadyMember?: number;
  failed?: number;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_super_admin)
    return { error: "Hromadné přidávání může jen super-admin." };

  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { error: "Neplatný e-mail." };
  if (wsIds.length === 0) return { error: "Vyber aspoň jednu firmu." };

  const resolved = await resolveOrInviteUser(normalized);
  if (resolved.error || !resolved.userId) return { error: resolved.error };

  let added = 0;
  let alreadyMember = 0;
  let failed = 0;
  for (const wsId of wsIds) {
    const { error: insertError } = await supabase
      .from("workspace_members")
      .insert({ workspace_id: wsId, user_id: resolved.userId, role });
    if (!insertError) added++;
    else if (insertError.code === "23505") alreadyMember++;
    else failed++;
  }

  return { ok: true, invited: resolved.invited, added, alreadyMember, failed };
}
