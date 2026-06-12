"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/types";

export async function inviteMember(
  wsId: string,
  email: string,
  role: Role
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };

  const { data: isAdmin } = await supabase.rpc("is_ws_admin", { ws: wsId });
  if (!isAdmin) return { error: "Na pozvánky nemáš oprávnění." };

  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { error: "Neplatný e-mail." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();

  let userId = existing?.id as string | undefined;

  if (!userId) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
      redirectTo: `${site}/auth/confirm`,
    });
    if (error || !data.user) {
      return { error: "Pozvánku se nepodařilo odeslat." };
    }
    userId = data.user.id;
  }

  // membership přes user-scoped klienta — RLS vynutí, že admina smí přidat jen super-admin
  const { error: insertError } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: wsId, user_id: userId, role });

  if (insertError) {
    if (insertError.code === "23505") return { error: "Už je členem workspace." };
    return { error: "Přidání se nezdařilo. Admina může jmenovat jen super-admin." };
  }
  return { ok: true };
}
