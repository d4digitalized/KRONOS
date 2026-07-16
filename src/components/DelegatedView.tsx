"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { fmtDate } from "@/lib/format";
import { cacheGet, cacheSet } from "@/lib/viewCache";
import { TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import TaskRow, { TaskGroup, dueBuckets } from "@/components/TaskRow";
import type { Membership, Task, TaskFollowup } from "@/lib/types";

// Modal se načte až při otevření karty — nezatěžuje základní bundle routy.
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

/** „čeká dnes / 1 den / 3 dny / 12 dní" */
function waitingFor(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days <= 0) return "čeká ode dneška";
  if (days === 1) return "čeká 1 den";
  if (days < 5) return `čeká ${days} dny`;
  return `čeká ${days} dní`;
}

export default function DelegatedView({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const cacheKey = `delegated:${wsId}:${userId}`;
  const cached = cacheGet<{ rows: TaskFollowup[]; members: Membership[] }>(cacheKey);
  const [rows, setRows] = useState<TaskFollowup[]>(cached?.rows ?? []);
  const [members, setMembers] = useState<Membership[]>(cached?.members ?? []);
  const [loading, setLoading] = useState(!cached);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const [fuRes, memRes] = await Promise.all([
      supabase
        .from("task_followups")
        .select(
          "*, contacts(name), tasks!inner(*, projects(name, position), board_columns(name))"
        )
        .eq("created_by", userId)
        .eq("workspace_id", wsId)
        .is("tasks.completed_at", null),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
    ]);
    const list = ((fuRes.data ?? []) as unknown as TaskFollowup[]).sort(
      (a, b) =>
        (a.tasks?.due_date ?? "9999").localeCompare(b.tasks?.due_date ?? "9999") ||
        a.created_at.localeCompare(b.created_at)
    );
    const mem = (memRes.data as unknown as Membership[]) ?? [];
    setRows(list);
    setMembers(mem);
    cacheSet(cacheKey, { rows: list, members: mem });
    setLoading(false);
  }, [supabase, wsId, userId, cacheKey]);

  useEffect(() => {
    load();
    // změna follow-upu v otevřené kartě — přenačti seznam
    const onChanged = () => load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

  function waitingName(row: TaskFollowup): string | null {
    if (row.waiting_user_id) {
      const m = members.find((x) => x.user_id === row.waiting_user_id);
      return m?.profiles?.full_name || m?.profiles?.email || "člen";
    }
    if (row.waiting_contact_id) return row.contacts?.name ?? "kontakt";
    return null; // čekání bez osoby (ruční přesun do Waiting on)
  }

  async function toggleDone(task: Task) {
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) {
      toast("Uložení se nezdařilo.", "error");
      return;
    }
    toast(`Hotovo: ${task.title}`);
    pingNotifyEmails();
    load();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  // stejné termínové skupiny jako Moje úkoly; chip čekání per úkol
  const followupByTask = new Map(rows.map((r) => [r.task_id, r]));
  const groups = dueBuckets(rows.map((r) => r.tasks!).filter(Boolean));

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="font-display text-lg font-semibold">Čekám na</h1>
        <p className="text-xs text-ink-soft/70">
          {rows.length === 0
            ? "Na nikoho nečekáš."
            : `Čekáš na dodání ${rows.length} úkolů`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="panel p-8 text-center text-sm text-ink-soft/70">
          Na nikoho nečekáš. Follow-up nastavíš na kartě úkolu volbou „Čekám na…".
        </p>
      ) : (
        groups.map((group) => (
          <TaskGroup
            key={group.key}
            label={group.label}
            count={group.tasks.length}
            accent={group.accent}
          >
            {group.tasks.map((task) => {
              const row = followupByTask.get(task.id);
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  onOpen={setOpenTask}
                  onToggleDone={toggleDone}
                  meta={
                    row && (
                      <span
                        className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                        title={`Follow-up od ${fmtDate(row.created_at.slice(0, 10))}`}
                      >
                        ⏳ {waitingName(row) ? `${waitingName(row)} · ` : ""}
                        {waitingFor(row.created_at)}
                      </span>
                    )
                  }
                />
              );
            })}
          </TaskGroup>
        ))
      )}

      {openTask && (
        <CardModal
          task={openTask}
          members={members}
          userId={userId}
          onClose={() => setOpenTask(null)}
          onChanged={() => {
            setOpenTask(null);
            load();
          }}
        />
      )}
    </div>
  );
}
