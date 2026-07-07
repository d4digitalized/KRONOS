// Vyprázdnění fronty notifikací → e-maily přes Resend. POUZE na serveru.
// Volá se hned po akci v aplikaci (/api/notify/run) a z inbound webhooku;
// /api/cron/notify zůstává pro ruční vyvolání. Řádky se atomicky zamlouvají,
// souběžné běhy jsou bezpečné.

import { createAdminClient } from "@/lib/supabase/admin";
import { APP_URL, emailLayout, escapeHtml, replyAddress, sendEmail } from "@/lib/email";

type QueueRow = {
  id: string;
  user_id: string;
  kind: "assigned" | "comment" | "mention";
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  task_title: string;
  actor_name: string;
  body: string;
};

function compose(n: QueueRow): { subject: string; html: string } {
  const link = n.project_id
    ? `${APP_URL}/w/${n.workspace_id}/b/${n.project_id}`
    : `${APP_URL}/w/${n.workspace_id}`;
  const title = escapeHtml(n.task_title);
  const actor = escapeHtml(n.actor_name || "Někdo");
  const button = `<p style="margin:16px 0 0;"><a href="${link}" style="display:inline-block;background:#0e7569;color:#fff;text-decoration:none;border-radius:8px;padding:8px 14px;font-size:14px;">Otevřít nástěnku</a></p>`;
  const canReply = n.task_id ? replyAddress(n.task_id, n.user_id) : null;
  const replyHint = canReply
    ? `<p style="margin:8px 0 0;font-size:12px;color:#5c636b;">Odpovědí na tento e-mail přidáš komentář ke kartě.</p>`
    : "";

  if (n.kind === "assigned") {
    return {
      subject: `Přiřazená karta: ${n.task_title}`,
      html: emailLayout(
        "Máš novou kartu",
        `<p style="margin:0;font-size:14px;">${actor} ti přiřadil(a) kartu <strong>„${title}“</strong>.</p>${button}${replyHint}`
      ),
    };
  }
  const quoted = `<blockquote style="margin:0;padding:8px 12px;background:#f5f6f7;border-left:3px solid #0e7569;border-radius:6px;font-size:14px;">${escapeHtml(n.body)}</blockquote>`;
  if (n.kind === "mention") {
    return {
      subject: `Zmínka: ${n.task_title}`,
      html: emailLayout(
        "Někdo tě zmínil",
        `<p style="margin:0 0 8px;font-size:14px;">${actor} tě zmínil(a) v komentáři ke kartě <strong>„${title}“</strong>:</p>${quoted}${button}${replyHint}`
      ),
    };
  }
  return {
    subject: `Nový komentář: ${n.task_title}`,
    html: emailLayout(
      "Nový komentář",
      `<p style="margin:0 0 8px;font-size:14px;">${actor} komentoval(a) kartu <strong>„${title}“</strong>:</p>${quoted}${button}${replyHint}`
    ),
  };
}

export async function drainNotifications(): Promise<{
  processed: number;
  sent: number;
}> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .is("emailed_at", null)
    .order("created_at")
    .limit(100);
  const queue = (data ?? []) as QueueRow[];
  if (queue.length === 0) return { processed: 0, sent: 0 };

  const userIds = [...new Set(queue.map((n) => n.user_id))];
  const [profilesRes, prefsRes, membersRes] = await Promise.all([
    supabase.from("profiles").select("id, email").in("id", userIds),
    supabase.from("notification_prefs").select("*").in("user_id", userIds),
    supabase
      .from("workspace_members")
      .select("user_id, workspace_id, notify_email")
      .in("user_id", userIds),
  ]);
  const emailById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id as string, p.email as string])
  );
  const prefsById = new Map(
    (prefsRes.data ?? []).map((p) => [p.user_id as string, p])
  );
  // per-firma notifikační e-mail (přebíjí účetní), klíč `user:workspace`
  const notifyOverride = new Map<string, string>();
  for (const m of membersRes.data ?? []) {
    if (m.notify_email)
      notifyOverride.set(`${m.user_id}:${m.workspace_id}`, m.notify_email as string);
  }

  let sent = 0;
  let processed = 0;
  for (const n of queue) {
    // atomické zamluvení řádku — při souběhu ho zpracuje právě jeden běh
    const { data: claimed } = await supabase
      .from("notifications")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", n.id)
      .is("emailed_at", null)
      .select("id");
    if (!claimed?.length) continue;
    processed += 1;

    const email =
      notifyOverride.get(`${n.user_id}:${n.workspace_id}`) ??
      emailById.get(n.user_id);
    const prefs = prefsById.get(n.user_id);
    const wants =
      n.kind === "assigned"
        ? (prefs?.on_assign ?? true)
        : n.kind === "mention"
          ? (prefs?.on_mention ?? true)
          : (prefs?.on_comment ?? true);
    if (!email || !wants) continue; // vyřízeno bez e-mailu (preference)

    try {
      const { subject, html } = compose(n);
      const replyTo = n.task_id ? replyAddress(n.task_id, n.user_id) : null;
      await sendEmail(email, subject, html, replyTo ?? undefined);
      sent += 1;
    } catch (err) {
      console.error("notify:", err);
      // vrátit do fronty — odešle se při další události
      await supabase
        .from("notifications")
        .update({ emailed_at: null })
        .eq("id", n.id);
    }
  }

  return { processed, sent };
}
