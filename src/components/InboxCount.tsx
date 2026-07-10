"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";

/** Živé počítadlo nezatříděných úkolů v Inboxu (viz InboxView: moje otevřené
    úkoly bez projektu, bez řešitele a bez follow-upu). Nula = nic nesvědí. */
export default function InboxCount({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const [tRes, fuRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, task_assignees(user_id), task_contact_assignees(contact_id)")
        .eq("workspace_id", wsId)
        .eq("created_by", userId)
        .is("project_id", null)
        .is("completed_at", null)
        .is("parent_id", null),
      supabase
        .from("task_followups")
        .select("task_id")
        .eq("workspace_id", wsId)
        .eq("created_by", userId),
    ]);
    const waiting = new Set((fuRes.data ?? []).map((r) => r.task_id as string));
    const rows = (tRes.data ?? []) as {
      id: string;
      task_assignees: unknown[];
      task_contact_assignees: unknown[];
    }[];
    setCount(
      rows.filter(
        (t) =>
          (t.task_assignees ?? []).length === 0 &&
          (t.task_contact_assignees ?? []).length === 0 &&
          !waiting.has(t.id)
      ).length
    );
  }, [supabase, wsId, userId]);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

  if (count === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-accent/15 px-1.5 py-px text-[11px] font-medium text-accent">
      {count}
    </span>
  );
}
