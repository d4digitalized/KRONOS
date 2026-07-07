// Odešle čekající notifikační e-maily hned po akci v aplikaci.
// Autorizace přihlášením — volá ho klient (fire-and-forget) po komentáři,
// přiřazení nebo dokončení karty. Fronta se atomicky zamlouvá, takže
// duplicitní volání nevadí a cizí e-maily vyvolat nelze (posílá se vždy
// jen právoplatným příjemcům).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { drainNotifications } from "@/lib/notify-drain";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return NextResponse.json(await drainNotifications());
}
