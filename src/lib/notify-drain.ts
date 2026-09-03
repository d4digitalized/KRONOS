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

type ThreadComment = {
  author: string;
  body: string;
  created_at: string;
};

const MAX_THREAD = 50;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function bodyHtml(body: string): string {
  return escapeHtml(body).replaceAll("\n", "<br>");
}

/** Celé vlákno komentářů od nejnovějšího; komentář, který notifikaci
 *  vyvolal (shoda autora a textu), je zvýrazněný. */
function renderThread(n: QueueRow, thread: ThreadComment[]): string {
  let highlighted = false;
  const items = thread.map((c) => {
    const isTrigger =
      !highlighted &&
      c.author === n.actor_name &&
      c.body.startsWith(n.body);
    if (isTrigger) highlighted = true;
    const border = isTrigger ? "3px solid #0e7569" : "3px solid #e2e5e8";
    const bg = isTrigger ? "#eef7f5" : "#f5f6f7";
    return `<div style="margin:0 0 8px;padding:8px 12px;background:${bg};border-left:${border};border-radius:6px;font-size:14px;">
<div style="margin:0 0 4px;font-size:12px;color:#5c636b;"><strong style="color:#1f2328;">${escapeHtml(c.author || "Někdo")}</strong> · ${formatDate(c.created_at)}</div>
<div>${bodyHtml(c.body)}</div>
</div>`;
  });
  const truncated =
    thread.length >= MAX_THREAD
      ? `<p style="margin:0 0 8px;font-size:12px;color:#5c636b;">Zobrazeno posledních ${MAX_THREAD} komentářů, starší najdeš v Kronosu.</p>`
      : "";
  return `<p style="margin:12px 0 8px;font-size:12px;color:#5c636b;text-transform:uppercase;letter-spacing:.04em;">Celá konverzace (od nejnovější)</p>${items.join(
    // oddělovač mezi komentáři — <hr> zobrazí i klienti, kteří styly bloků ořežou
    `<hr style="border:none;border-top:1px solid #e2e5e8;margin:10px 0;">`
  )}${truncated}`;
}

function compose(
  n: QueueRow,
  thread: ThreadComment[]
): { subject: string; html: string } {
  // /t/<id> dohledá úkol a otevře jeho kartu přímo (nástěnka i úkol bez
  // projektu); bez task_id (nemělo by nastat) padáme na firmu
  const link = n.task_id
    ? `${APP_URL}/t/${n.task_id}`
    : `${APP_URL}/w/${n.workspace_id}`;
  const title = escapeHtml(n.task_title);
  const actor = escapeHtml(n.actor_name || "Někdo");
  const button = `<p style="margin:14px 0 0;font-size:14px;"><a href="${link}" style="color:#0e7569;font-weight:600;text-decoration:none;">Otevřít v Kronosu&nbsp;→</a></p>`;
  const canReply = n.task_id ? replyAddress(n.task_id, n.user_id) : null;
  const replyHint = canReply
    ? `<p style="margin:14px 0 0;border-top:1px solid #e2e5e8;padding-top:10px;font-size:12px;color:#5c636b;">Odpovědí na tento e-mail přidáš komentář ke kartě.</p>`
    : "";

  if (n.kind === "assigned") {
    return {
      subject: `Přiřazená karta: ${n.task_title}`,
      html: emailLayout(
        `Nová karta: ${title}`,
        `<p style="margin:0;font-size:14px;">${actor} ti přiřadil(a) tuto kartu.</p>${button}${replyHint}`
      ),
    };
  }
  // vlákno je k dispozici → celý přepis od nejnovějšího; bez něj (smazané
  // komentáře, výpadek dotazu) aspoň citace samotné zprávy
  const conversation =
    thread.length > 0
      ? renderThread(n, thread)
      : `<blockquote style="margin:0;padding:8px 12px;background:#f5f6f7;border-left:3px solid #0e7569;border-radius:6px;font-size:14px;">${bodyHtml(n.body)}</blockquote>`;
  if (n.kind === "mention") {
    return {
      subject: `Zmínka: ${n.task_title}`,
      html: emailLayout(
        `Zmínka na kartě: ${title}`,
        `<p style="margin:0;font-size:14px;">${actor} tě zmínil(a) v komentáři.</p>${conversation}${button}${replyHint}`
      ),
    };
  }
  return {
    subject: `Nový komentář: ${n.task_title}`,
    html: emailLayout(
      `Komentář na kartě: ${title}`,
      `<p style="margin:0;font-size:14px;">${actor} napsal(a) komentář.</p>${conversation}${button}${replyHint}`
    ),
  };
}

/** Komentáře karet z fronty, per karta od nejnovějšího (max MAX_THREAD). */
async function loadThreads(
  supabase: ReturnType<typeof createAdminClient>,
  taskIds: string[]
): Promise<Map<string, ThreadComment[]>> {
  const threads = new Map<string, ThreadComment[]>();
  if (taskIds.length === 0) return threads;
  const { data: comments } = await supabase
    .from("task_comments")
    .select("task_id, author_id, body, created_at")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });
  if (!comments?.length) return threads;
  const authorIds = [...new Set(comments.map((c) => c.author_id as string))];
  const { data: authors } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", authorIds);
  const nameById = new Map(
    (authors ?? []).map((a) => [
      a.id as string,
      ((a.full_name as string) || (a.email as string)) ?? "",
    ])
  );
  for (const c of comments) {
    const list = threads.get(c.task_id as string) ?? [];
    if (list.length >= MAX_THREAD) continue;
    list.push({
      author: nameById.get(c.author_id as string) ?? "",
      body: c.body as string,
      created_at: c.created_at as string,
    });
    threads.set(c.task_id as string, list);
  }
  return threads;
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
  const threadTaskIds = [
    ...new Set(
      queue
        .filter((n) => n.kind !== "assigned" && n.task_id)
        .map((n) => n.task_id as string)
    ),
  ];
  const [profilesRes, prefsRes, membersRes, threads] = await Promise.all([
    supabase.from("profiles").select("id, email").in("id", userIds),
    supabase.from("notification_prefs").select("*").in("user_id", userIds),
    supabase
      .from("workspace_members")
      .select("user_id, workspace_id, notify_email, notify_enabled")
      .in("user_id", userIds),
    loadThreads(supabase, threadTaskIds),
  ]);
  const emailById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id as string, p.email as string])
  );
  const prefsById = new Map(
    (prefsRes.data ?? []).map((p) => [p.user_id as string, p])
  );
  // per-firma notifikační e-mail (přebíjí účetní), klíč `user:workspace`
  const notifyOverride = new Map<string, string>();
  // členové s notifikacemi vypnutými adminem, klíč `user:workspace`
  const notifyOff = new Set<string>();
  for (const m of membersRes.data ?? []) {
    if (m.notify_email)
      notifyOverride.set(`${m.user_id}:${m.workspace_id}`, m.notify_email as string);
    if (m.notify_enabled === false)
      notifyOff.add(`${m.user_id}:${m.workspace_id}`);
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
        ? // maily o přiřazení jsou vypnuté, dokud si je člověk nezapne
          (prefs?.on_assign ?? false)
        : n.kind === "mention"
          ? (prefs?.on_mention ?? true)
          : (prefs?.on_comment ?? true);
    if (!email || !wants) continue; // vyřízeno bez e-mailu (preference)
    if (notifyOff.has(`${n.user_id}:${n.workspace_id}`)) continue; // vypnul admin

    try {
      const { subject, html } = compose(
        n,
        n.task_id ? (threads.get(n.task_id) ?? []) : []
      );
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
