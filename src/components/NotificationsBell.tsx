"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Obrazovka notifikací po označení přečtených řekne zvonečku, ať se obnoví. */
export const NOTIFICATIONS_CHANGED_EVENT = "toggled:notifications-changed";

export default function NotificationsBell({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);
    setUnread(count ?? 0);
  }, [supabase, userId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    const onChange = () => load();
    window.addEventListener("focus", onChange);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onChange);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    };
  }, [load]);

  return (
    <Link
      href={`/w/${wsId}/notifications`}
      aria-label={
        unread > 0 ? `Notifikace: ${unread} nepřečtených` : "Notifikace"
      }
      title="Notifikace"
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-black/5"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
