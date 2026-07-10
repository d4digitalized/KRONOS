"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { priorityColor } from "@/lib/priority";
import { fmtDate } from "@/lib/format";
import { cacheGet, cacheSet } from "@/lib/viewCache";
import { TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import { ProjectDot } from "@/components/ProjectPicker";
import Avatar, { type AvatarLike } from "@/components/Avatar";
import type { Membership, Task } from "@/lib/types";

// Modal se načte až při otevření karty — nezatěžuje základní bundle routy.
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

type Bucket = { key: string; label: string; tasks: Task[]; accent?: boolean };

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Rozdělí úkoly podle termínu: po termínu / dnes / tento týden / později / bez termínu. */
function buckets(tasks: Task[]): Bucket[] {
  const now = new Date();
  const today = isoDay(now);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const endOfWeek = isoDay(sunday);

  const groups: Bucket[] = [
    { key: "overdue", label: "Po termínu", tasks: [], accent: true },
    { key: "today", label: "Dnes", tasks: [] },
    { key: "week", label: "Tento týden", tasks: [] },
    { key: "later", label: "Později", tasks: [] },
    { key: "nodate", label: "Bez termínu", tasks: [] },
  ];
  for (const t of tasks) {
    if (!t.due_date) groups[4].tasks.push(t);
    else if (t.due_date < today) groups[0].tasks.push(t);
    else if (t.due_date === today) groups[1].tasks.push(t);
    else if (t.due_date <= endOfWeek) groups[2].tasks.push(t);
    else groups[3].tasks.push(t);
  }
  return groups.filter((g) => g.tasks.length > 0);
}

export default function MyTasksView({
  wsId,
  userId,
  heading,
  profile,
}: {
  wsId: string;
  userId: string;
  heading: string;
  profile: AvatarLike | null;
}) {
  const supabase = createClient();
  const cacheKey = `mytasks:${wsId}:${userId}`;
  const cached = cacheGet<{ tasks: Task[]; members: Membership[] }>(cacheKey);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks ?? []);
  const [members, setMembers] = useState<Membership[]>(cached?.members ?? []);
  const [loading, setLoading] = useState(!cached);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const [mineRes, memRes, fuRes] = await Promise.all([
      supabase
        .from("task_assignees")
        .select(
          "tasks!inner(*, projects(name, position), board_columns(name))"
        )
        .eq("user_id", userId)
        .eq("tasks.workspace_id", wsId)
        .is("tasks.completed_at", null)
        .is("tasks.parent_id", null),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      // úkoly, kde jsem nastavil follow-up, žijí na stránce Delegované
      supabase
        .from("task_followups")
        .select("task_id")
        .eq("created_by", userId)
        .eq("workspace_id", wsId),
    ]);
    const waiting = new Set((fuRes.data ?? []).map((r) => r.task_id as string));
    const mine = ((mineRes.data ?? []) as unknown as { tasks: Task }[])
      .map((r) => r.tasks)
      .filter((t) => !waiting.has(t.id))
      .sort(
        (a, b) =>
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
          (a.priority ?? 4) - (b.priority ?? 4) ||
          a.title.localeCompare(b.title, "cs")
      );
    const mem = (memRes.data as unknown as Membership[]) ?? [];
    setTasks(mine);
    setMembers(mem);
    cacheSet(cacheKey, { tasks: mine, members: mem });
    setLoading(false);
  }, [supabase, wsId, userId, cacheKey]);

  useEffect(() => {
    load();
    // nový úkol z plovoucího „+" v layoutu — přenačti seznam
    const onChanged = () => load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

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
    pingNotifyEmails(); // opakovaná karta může přiřadit další výskyt
    load();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const groups = buckets(tasks);
  const today = isoDay(new Date());

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3">
        <Avatar profile={profile} colorKey={userId} size="lg" />
        <div>
          <h1 className="font-display text-lg font-semibold">{heading}</h1>
          <p className="text-xs text-ink-soft/70">
            {tasks.length === 0
              ? "Žádné otevřené úkoly."
              : `${tasks.length} otevřených úkolů`}
          </p>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="panel p-8 text-center text-sm text-ink-soft/70">
          Nemáš žádné otevřené úkoly. 🎉
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="panel">
            <h2
              className={`border-b border-line/70 px-3 py-2 text-sm font-semibold ${
                group.accent ? "text-danger" : ""
              }`}
            >
              {group.label}
              <span className="ml-2 text-xs font-normal text-ink-soft/60">
                {group.tasks.length}
              </span>
            </h2>
            <div className="divide-y divide-line/50">
              {group.tasks.map((task) => {
                const flag = priorityColor(task.priority ?? 4);
                const overdue = task.due_date && task.due_date < today;
                return (
                  <div
                    key={task.id}
                    onClick={() => setOpenTask(task)}
                    style={flag ? { boxShadow: `inset 3px 0 0 ${flag}` } : undefined}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-black/[.02]"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => toggleDone(task)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Hotovo: ${task.title}`}
                      className="h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {task.title}
                        {task.recurrence && (
                          <span
                            className="ml-1 text-xs text-ink-soft/50"
                            title="Opakovaný úkol"
                          >
                            ↻
                          </span>
                        )}
                        {task.is_private && (
                          <span
                            className="ml-1 text-xs text-ink-soft/50"
                            title="Skrytý úkol — vidíš ho jen ty"
                          >
                            🔒
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-ink-soft/70">
                        <ProjectDot
                          id={task.project_id}
                          className="mr-1 h-2 w-2 align-middle"
                        />
                        {task.projects?.name ?? "—"}
                        {task.board_columns?.name
                          ? ` · ${task.board_columns.name}`
                          : ""}
                      </p>
                    </div>
                    {task.due_date && (
                      <span
                        className={`whitespace-nowrap text-xs ${
                          overdue ? "font-medium text-red-600" : "text-ink-soft"
                        }`}
                      >
                        {fmtDate(task.due_date)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
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
