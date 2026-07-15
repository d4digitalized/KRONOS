"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { PRIORITIES } from "@/lib/priority";
import { cacheGet, cacheSet } from "@/lib/viewCache";
import { TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import { ProjectDot } from "@/components/ProjectPicker";
import Avatar from "@/components/Avatar";
import TaskRow, { TaskGroup } from "@/components/TaskRow";
import type { Membership, Project, Task } from "@/lib/types";

// Modal karty se dogeneruje až při otevření (mimo základní bundle routy).
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

type Status = "active" | "done" | "all";

export default function TasksView({
  wsId,
  userId,
  isAdmin,
}: {
  wsId: string;
  userId: string;
  isAdmin: boolean;
}) {
  const supabase = createClient();
  const cacheKey = `tasks:${wsId}`;
  const cached = cacheGet<{
    tasks: Task[];
    projects: Project[];
    members: Membership[];
    assignees: Record<string, string[]>;
  }>(cacheKey);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks ?? []);
  const [projects, setProjects] = useState<Project[]>(cached?.projects ?? []);
  const [members, setMembers] = useState<Membership[]>(cached?.members ?? []);
  const [assignees, setAssignees] = useState<Record<string, string[]>>(
    cached?.assignees ?? {}
  );
  const [loading, setLoading] = useState(!cached);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // můj tým: já + lidé, kterým smím zadávat (assign_grants); admin vidí všechny
  const [grants, setGrants] = useState<Set<string>>(new Set());
  // filtry
  const [fText, setFText] = useState("");
  const [fProject, setFProject] = useState("");
  const [fPriority, setFPriority] = useState(0);
  const [fAssignee, setFAssignee] = useState("");
  const [fStatus, setFStatus] = useState<Status>("active");

  const load = useCallback(async () => {
    const [taskRes, projRes, memRes, taRes, grantRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*, projects(name, position), board_columns(name)")
        .eq("workspace_id", wsId)
        .is("parent_id", null),
      supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("archived", false)
        .order("position")
        .order("name"),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      supabase
        .from("task_assignees")
        .select("task_id, user_id, tasks!inner(workspace_id)")
        .eq("tasks.workspace_id", wsId),
      supabase
        .from("assign_grants")
        .select("target_id")
        .eq("workspace_id", wsId)
        .eq("user_id", userId),
    ]);
    const nextTasks = (taskRes.data as Task[]) ?? [];
    const nextProjects = (projRes.data as Project[]) ?? [];
    const nextMembers = (memRes.data as unknown as Membership[]) ?? [];
    const byTask: Record<string, string[]> = {};
    for (const row of taRes.data ?? []) {
      byTask[row.task_id] = [...(byTask[row.task_id] ?? []), row.user_id as string];
    }
    setTasks(nextTasks);
    setProjects(nextProjects);
    setMembers(nextMembers);
    setAssignees(byTask);
    setGrants(new Set((grantRes.data ?? []).map((r) => r.target_id as string)));
    cacheSet(cacheKey, {
      tasks: nextTasks,
      projects: nextProjects,
      members: nextMembers,
      assignees: byTask,
    });
    setLoading(false);
  }, [supabase, wsId, cacheKey]);

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
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq("id", task.id);
    if (error) toast("Uložení se nezdařilo.", "error");
    else pingNotifyEmails(); // opakovaná karta může přiřadit další výskyt
    load();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const q = fText.trim().toLowerCase();
  // tým = já + lidé s grantem; admin vidí všechny
  const team = new Set([userId, ...grants]);
  const teamMembers = isAdmin
    ? members
    : members.filter((m) => team.has(m.user_id));
  const memberName = (m: Membership) =>
    m.profiles?.full_name || m.profiles?.email || "?";
  const switcherMembers = [...teamMembers].sort((a, b) =>
    memberName(a).localeCompare(memberName(b), "cs")
  );
  const visible = tasks
    // Inbox je soukromý: úkol bez projektu a bez řešitele patří jen svému
    // autorovi — ani admin ho tady nevidí (má ho autor v Inboxu).
    .filter(
      (t) =>
        t.project_id !== null ||
        t.created_by === userId ||
        (assignees[t.id] ?? []).length > 0
    )
    .filter((t) =>
      isAdmin ? true : (assignees[t.id] ?? []).some((id) => team.has(id))
    )
    .filter((t) =>
      fStatus === "all" ? true : fStatus === "done" ? !!t.completed_at : !t.completed_at
    )
    .filter(
      (t) =>
        (!q ||
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)) &&
        (!fProject || t.project_id === fProject) &&
        (fPriority === 0 || (t.priority ?? 4) === fPriority) &&
        (!fAssignee || (assignees[t.id] ?? []).includes(fAssignee))
    )
    .sort(
      (a, b) =>
        (a.projects?.position ?? Number.MAX_SAFE_INTEGER) -
          (b.projects?.position ?? Number.MAX_SAFE_INTEGER) ||
        (a.priority ?? 4) - (b.priority ?? 4) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        a.title.localeCompare(b.title, "cs")
    );

  // skupiny po projektech (v pořadí řazení; bez projektu na konci)
  const projectGroups: { key: string; label: string; tasks: Task[] }[] = [];
  const groupIndex = new Map<string, number>();
  for (const t of visible) {
    const key = t.project_id ?? "none";
    if (!groupIndex.has(key)) {
      groupIndex.set(key, projectGroups.length);
      projectGroups.push({
        key,
        label: t.projects?.name ?? "Bez projektu",
        tasks: [],
      });
    }
    projectGroups[groupIndex.get(key)!].tasks.push(t);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">Task force</h1>
        <span className="text-xs text-ink-soft/70">
          úkoly všech ve Vaší skupině
        </span>
        <span className="flex-1" />
        <input
          type="search"
          placeholder="Hledat v úkolech…"
          value={fText}
          onChange={(e) => setFText(e.target.value)}
          className="input w-44 px-2 py-1 text-sm"
        />
        <select
          value={fProject}
          onChange={(e) => setFProject(e.target.value)}
          aria-label="Filtr projektu"
          className="input px-2 py-1 text-sm"
        >
          <option value="">Projekt: vše</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={fPriority}
          onChange={(e) => setFPriority(Number(e.target.value))}
          aria-label="Filtr priority"
          className="input px-2 py-1 text-sm"
        >
          <option value={0}>Priorita: vše</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as Status)}
          aria-label="Filtr stavu"
          className="input px-2 py-1 text-sm"
        >
          <option value="active">Aktivní</option>
          <option value="done">Dokončené</option>
          <option value="all">Vše</option>
        </select>
      </div>

      {/* přepínač lidí: kliknutím na avatar vidím, na čem kdo dělá */}
      {switcherMembers.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFAssignee("")}
            aria-pressed={!fAssignee}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !fAssignee
                ? "border-transparent bg-accent text-white"
                : "border-line text-ink-soft hover:border-ink-soft/40"
            }`}
          >
            Všichni
          </button>
          {switcherMembers.map((m) => {
            const on = fAssignee === m.user_id;
            const name = memberName(m);
            return (
              <button
                key={m.user_id}
                onClick={() => setFAssignee(on ? "" : m.user_id)}
                aria-pressed={on}
                aria-label={`Na čem dělá ${name}`}
                title={name}
                className={`inline-flex items-center rounded-full border transition-colors ${
                  on
                    ? "gap-1.5 border-accent bg-accent-soft py-0.5 pl-0.5 pr-2 text-xs font-medium text-accent"
                    : "border-transparent p-0.5 hover:border-line"
                }`}
              >
                <Avatar profile={m.profiles} colorKey={m.user_id} size="md" />
                {on && name}
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="panel p-6 text-center text-sm text-ink-soft/70">
          Žádné úkoly neodpovídají filtrům.
        </p>
      ) : (
        projectGroups.map((group) => (
          <TaskGroup
            key={group.key}
            label={
              <span className="inline-flex items-center gap-1.5">
                <ProjectDot
                  id={group.key === "none" ? null : group.key}
                  className="h-2 w-2"
                />
                {group.label}
              </span>
            }
            count={group.tasks.length}
          >
            {group.tasks.map((task) => {
              const taskAssignees = (assignees[task.id] ?? [])
                .map((id) => members.find((m) => m.user_id === id))
                .filter((m): m is Membership => !!m);
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  onOpen={setOpenTask}
                  onToggleDone={toggleDone}
                  showProject={false}
                  meta={
                    taskAssignees.length > 0 && (
                      <span className="flex -space-x-1.5">
                        {taskAssignees.slice(0, 4).map((m) => (
                          <Avatar
                            key={m.user_id}
                            profile={m.profiles}
                            colorKey={m.user_id}
                            size="sm"
                            className="border border-surface"
                          />
                        ))}
                        {taskAssignees.length > 4 && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-surface bg-black/10 text-[9px] font-medium text-ink-soft">
                            +{taskAssignees.length - 4}
                          </span>
                        )}
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
