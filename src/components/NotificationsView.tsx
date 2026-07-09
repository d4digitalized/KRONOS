"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/components/NotificationsBell";
import type { AppNotification } from "@/lib/types";

const KIND_ICON: Record<AppNotification["kind"], string> = {
  assigned:
    "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  comment:
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  // zavináč
  mention:
    "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
};

const KIND_TEXT: Record<AppNotification["kind"], string> = {
  assigned: "ti přiřadil(a) kartu",
  comment: "komentoval(a) kartu",
  mention: "tě zmínil(a) v komentáři ke kartě",
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsView({ userId }: { userId: string }) {
  const supabase = createClient();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    setItems((data as AppNotification[]) ?? []);
    setLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    load();
  }, [load]);

  function notifyBell() {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  }

  async function markRead(n: AppNotification) {
    if (n.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((i) => (i.id === n.id ? { ...i, read_at: now } : i))
    );
    await supabase.from("notifications").update({ read_at: now }).eq("id", n.id);
    notifyBell();
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) {
      toast("Označení se nezdařilo.", "error");
      return;
    }
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? now })));
    notifyBell();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const unread = items.filter((i) => !i.read_at).length;

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-lg font-semibold">Notifikace</h1>
        {unread > 0 && (
          <span className="chip">{unread} nepřečtených</span>
        )}
        <span className="flex-1" />
        {unread > 0 && (
          <button onClick={markAllRead} className="btn-ghost text-xs">
            Označit vše jako přečtené
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="panel p-6 text-center text-sm text-ink-soft/70">
          Zatím žádné notifikace. Objeví se tu přiřazené karty a komentáře.
        </p>
      ) : (
        <div className="divide-y divide-line/50 panel">
          {items.map((n) => {
            const href = n.project_id
              ? `/w/${n.workspace_id}/b/${n.project_id}`
              : `/w/${n.workspace_id}`;
            return (
              <Link
                key={n.id}
                href={href}
                onClick={() => markRead(n)}
                className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-black/[.02] ${
                  n.read_at ? "" : "bg-accent-soft/40"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    n.read_at
                      ? "bg-black/5 text-ink-soft"
                      : "bg-accent-soft text-accent"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                    aria-hidden
                  >
                    <path d={KIND_ICON[n.kind]} />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    <span className="font-medium">{n.actor_name || "Někdo"}</span>{" "}
                    {KIND_TEXT[n.kind]}{" "}
                    <span className="font-medium">„{n.task_title}“</span>
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block truncate text-sm text-ink-soft">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs text-ink-soft/60">
                    {fmtWhen(n.created_at)}
                  </span>
                </span>
                {!n.read_at && (
                  <span
                    className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
                    aria-label="Nepřečtené"
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
