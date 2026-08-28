"use server";

import { createClient } from "@/lib/supabase/server";
import {
  syncTaskCalendarCore,
  type CalendarSyncResult,
} from "@/lib/calendarSync";

/** Propíše plánované okno úkolu do kalendářů „{jméno} - KRONOS" jeho
    řešitelů (bez okna události maže). Volá se po uložení okna na kartě
    a z Mého dne; jádro sdílí s MCP serverem (lib/calendarSync). */
export async function syncTaskCalendar(
  taskId: string
): Promise<CalendarSyncResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };
  return syncTaskCalendarCore(supabase, user.id, taskId);
}
