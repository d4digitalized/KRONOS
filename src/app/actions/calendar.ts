"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createKronosCalendar,
  deleteEvent,
  googleConfigured,
  upsertEvent,
  workspaceDomain,
} from "@/lib/google";

/** E-mail, pod kterým jde uživatel impersonovat: účet ve Workspace doméně
    (login e-mail, případně per-firma notifikační e-mail). Jinak null. */
function domainEmail(
  profileEmail: string | null,
  notifyEmail: string | null
): string | null {
  const suffix = `@${workspaceDomain()}`;
  if (profileEmail?.toLowerCase().endsWith(suffix)) return profileEmail;
  if (notifyEmail?.toLowerCase().endsWith(suffix)) return notifyEmail;
  return null;
}

/** Propíše plánované okno úkolu do kalendářů „Kronos" jeho řešitelů
    (bez okna události maže). Volá se po uložení okna na kartě. */
export async function syncTaskCalendar(
  taskId: string
): Promise<{ ok?: true; synced?: number; skipped?: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };
  if (!googleConfigured())
    return { error: "Google kalendář není na serveru nastavený." };

  // úkol čteme pod uživatelem — RLS ověří, že na něj smí
  const { data: task } = await supabase
    .from("tasks")
    .select("id, title, workspace_id, planned_start, planned_end, projects(name)")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return { error: "Úkol nenalezen." };

  const admin = createAdminClient();
  const [taRes, existingRes] = await Promise.all([
    admin
      .from("task_assignees")
      .select("user_id, profiles(email)")
      .eq("task_id", taskId),
    admin.from("task_calendar_events").select("*").eq("task_id", taskId),
  ]);

  // cíl = členové-řešitelé; úkol bez řešitele plánuje ten, kdo okno vyplnil
  let targets = (taRes.data ?? []).map((r) => ({
    userId: r.user_id as string,
    email: (r.profiles as { email?: string } | null)?.email ?? null,
  }));
  if (targets.length === 0)
    targets = [{ userId: user.id, email: user.email ?? null }];

  const { data: members } = await admin
    .from("workspace_members")
    .select("user_id, notify_email")
    .eq("workspace_id", task.workspace_id)
    .in("user_id", targets.map((t) => t.userId));
  const notifyByUser = new Map(
    (members ?? []).map((m) => [m.user_id as string, m.notify_email as string])
  );

  const hasWindow = !!(task.planned_start && task.planned_end);
  const projectName =
    (task.projects as { name?: string } | null)?.name ?? "Bez projektu";
  const existing = existingRes.data ?? [];
  let synced = 0;
  let skipped = 0;

  try {
    for (const target of targets) {
      const email = domainEmail(
        target.email,
        notifyByUser.get(target.userId) ?? null
      );
      const row = existing.find((e) => e.user_id === target.userId);
      if (!email) {
        skipped += 1;
        continue;
      }

      // kalendář „Kronos" — jednou založit, pak používat cachované id
      let calendarId = (
        await admin
          .from("google_calendars")
          .select("calendar_id")
          .eq("user_id", target.userId)
          .maybeSingle()
      ).data?.calendar_id as string | undefined;

      if (!hasWindow) {
        if (row && calendarId)
          await deleteEvent(email, calendarId, row.event_id as string);
        if (row)
          await admin
            .from("task_calendar_events")
            .delete()
            .eq("task_id", taskId)
            .eq("user_id", target.userId);
        continue;
      }

      if (!calendarId) {
        calendarId = await createKronosCalendar(email);
        await admin
          .from("google_calendars")
          .upsert({ user_id: target.userId, calendar_id: calendarId });
      }

      const eventId = await upsertEvent(
        email,
        calendarId,
        (row?.event_id as string) ?? null,
        {
          summary: task.title,
          description: `Kronos · ${projectName}`,
          start: task.planned_start!,
          end: task.planned_end!,
        }
      );
      await admin.from("task_calendar_events").upsert({
        task_id: taskId,
        user_id: target.userId,
        event_id: eventId,
        updated_at: new Date().toISOString(),
      });
      synced += 1;
    }

    // uklidit události lidí, kteří už nejsou mezi cíli (odebraný řešitel)
    for (const row of existing) {
      if (targets.some((t) => t.userId === row.user_id)) continue;
      const calendarId = (
        await admin
          .from("google_calendars")
          .select("calendar_id")
          .eq("user_id", row.user_id)
          .maybeSingle()
      ).data?.calendar_id as string | undefined;
      const { data: prof } = await admin
        .from("profiles")
        .select("email")
        .eq("id", row.user_id)
        .maybeSingle();
      const email = domainEmail(
        (prof?.email as string) ?? null,
        notifyByUser.get(row.user_id as string) ?? null
      );
      if (email && calendarId)
        await deleteEvent(email, calendarId, row.event_id as string);
      await admin
        .from("task_calendar_events")
        .delete()
        .eq("task_id", taskId)
        .eq("user_id", row.user_id);
    }
  } catch (err) {
    console.error("calendar sync failed", err);
    // konkrétní příčina do toastu — bez ní se to nedá ladit z UI
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Zápis do kalendáře selhal: ${msg.slice(0, 220)}` };
  }

  return { ok: true, synced, skipped };
}
