"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { posBetween } from "@/lib/position";
import { toast } from "@/lib/toast";
import { PRIORITIES, priorityColor } from "@/lib/priority";
import { fmtDate } from "@/lib/format";
import ProjectPicker, { ProjectDot } from "@/components/ProjectPicker";
import Picker from "@/components/Picker";
import Avatar from "@/components/Avatar";
import CardModal from "@/components/CardModal";
import type { Membership, Project, Task } from "@/lib/types";

const USER_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // zadání nového úkolu (admin)
  const [addTitle, setAddTitle] = useState("");
  const [addProject, setAddProject] = useState("");
  const [addAssignee, setAddAssignee] = useState<string | null>(null);
  const [addProjMembers, setAddProjMembers] = useState<Set<string>>(new Set());
  // filtry
  const [fText, setFText] = useState("");
  const [fProject, setFProject] = useState("");
  const [fPriority, setFPriority] = useState(0);
  const [fAssignee, setFAssignee] = useState("");
  const [fStatus, setFStatus] = useState<Status>("active");

  const load = useCallback(async () => {
    const [taskRes, projRes, memRes, taRes] = await Promise.all([
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
        .select("user_id, role, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color)")
        .eq("workspace_id", wsId),
      supabase
        .from("task_assignees")
        .select("task_id, user_id, tasks!inner(workspace_id)")
        .eq("tasks.workspace_id", wsId),
    ]);
    setTasks((taskRes.data as Task[]) ?? []);
    setProjects((projRes.data as Project[]) ?? []);
    setMembers((memRes.data as unknown as Membership[]) ?? []);
    const byTask: Record<string, string[]> = {};
    for (const row of taRes.data ?? []) {
      byTask[row.task_id] = [...(byTask[row.task_id] ?? []), row.user_id as string];
    }
    setAssignees(byTask);
    setLoading(false);
  }, [supabase, wsId]);

  useEffect(() => {
    load();
  }, [load]);

  // řešitelem smí být jen člen zvoleného projektu (nebo admin ws)
  useEffect(() => {
    if (!addProject) {
      setAddProjMembers(new Set());
      setAddAssignee(null);
      return;
    }
    supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", addProject)
      .then(({ data }) => {
        const ids = new Set((data ?? []).map((r) => r.user_id as string));
        setAddProjMembers(ids);
        setAddAssignee((prev) => {
          if (!prev) return prev;
          const stillOk =
            ids.has(prev) ||
            members.find((m) => m.user_id === prev)?.role === "admin";
          return stillOk ? prev : null;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addProject]);

  const addAssignable = members.filter(
    (m) => addProjMembers.has(m.user_id) || m.role === "admin"
  );

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = addTitle.trim();
    if (!title) return;
    if (!addProject) {
      toast("Vyber projekt úkolu.", "error");
      return;
    }
    // úkol jde na konec prvního sloupce nástěnky projektu
    const { data: col } = await supabase
      .from("board_columns")
      .select("id")
      .eq("project_id", addProject)
      .order("position")
      .limit(1)
      .maybeSingle();
    const { data: last } = await supabase
      .from("tasks")
      .select("position")
      .eq("project_id", addProject)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: wsId,
        project_id: addProject,
        column_id: col?.id ?? null,
        title,
        position: posBetween(last?.position, undefined),
      })
      .select("id")
      .single();
    if (error || !created) {
      toast("Úkol se nepodařilo přidat.", "error");
      return;
    }
    if (addAssignee) {
      const { error: taError } = await supabase
        .from("task_assignees")
        .insert({ task_id: created.id, user_id: addAssignee });
      if (taError) toast("Řešitele se nepodařilo přiřadit.", "error");
    }
    setAddTitle("");
    load();
  }

  async function toggleDone(task: Task) {
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq("id", task.id);
    if (error) toast("Uložení se nezdařilo.", "error");
    load();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const q = fText.trim().toLowerCase();
  const visible = tasks
    .filter((t) => (isAdmin ? true : (assignees[t.id] ?? []).includes(userId)))
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
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-lg font-semibold">Úkoly</h1>
        {!isAdmin && (
          <span className="text-xs text-ink-soft/70">jen úkoly, kde jsi řešitel</span>
        )}
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
        {isAdmin && (
          <select
            value={fAssignee}
            onChange={(e) => setFAssignee(e.target.value)}
            aria-label="Filtr řešitele"
            className="input px-2 py-1 text-sm"
          >
            <option value="">Řešitel: všichni</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profiles?.full_name || m.profiles?.email}
              </option>
            ))}
          </select>
        )}
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

      {isAdmin && (
        <form onSubmit={addTask} className="flex flex-wrap items-center gap-2 panel py-2 pl-4 pr-2">
          <input
            type="text"
            placeholder="Nový úkol…"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            className="input-quiet -ml-2 min-w-40 flex-1 px-2 py-1.5 text-sm"
          />
          <ProjectPicker
            projects={projects}
            value={addProject || null}
            onChange={(id) => setAddProject(id ?? "")}
            align="left"
          />
          <Picker
            options={[
              { id: null, label: "Bez řešitele" },
              ...addAssignable.map((m) => ({
                id: m.user_id as string | null,
                label: m.profiles?.full_name || m.profiles?.email || "?",
              })),
            ]}
            value={addAssignee}
            onChange={setAddAssignee}
            placeholder="Řešitel"
            iconPath={USER_ICON}
            ariaLabel="Řešitel"
            align="left"
            disabled={!addProject}
          />
          <button type="submit" className="btn-primary">
            Přidat úkol
          </button>
        </form>
      )}

      {visible.length === 0 ? (
        <p className="panel p-6 text-center text-sm text-ink-soft/70">
          Žádné úkoly neodpovídají filtrům.
        </p>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/70 text-left text-xs text-ink-soft">
                <th className="w-8 px-3 py-2" aria-label="Hotovo" />
                <th className="px-2 py-2 font-medium">Úkol</th>
                <th className="px-2 py-2 font-medium">Projekt</th>
                <th className="px-2 py-2 font-medium">Sloupec</th>
                <th className="px-2 py-2 font-medium">Řešitelé</th>
                <th className="px-2 py-2 font-medium">Termín</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => {
                const flag = priorityColor(task.priority ?? 4);
                const overdue =
                  !task.completed_at && task.due_date && task.due_date < today;
                const taskAssignees = (assignees[task.id] ?? [])
                  .map((id) => members.find((m) => m.user_id === id))
                  .filter((m): m is Membership => !!m);
                return (
                  <tr
                    key={task.id}
                    onClick={() => setOpenTask(task)}
                    className="cursor-pointer border-b border-line/50 last:border-0 hover:bg-black/[.02]"
                    style={flag ? { boxShadow: `inset 3px 0 0 ${flag}` } : undefined}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!task.completed_at}
                        onChange={() => toggleDone(task)}
                        aria-label={`Hotovo: ${task.title}`}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="max-w-72 px-2 py-2">
                      <span
                        className={`block truncate ${
                          task.completed_at ? "text-ink-soft/70 line-through" : ""
                        }`}
                      >
                        {task.title}
                        {task.recurrence && (
                          <span className="ml-1 text-xs text-ink-soft/50" title="Opakovaný úkol">
                            ↻
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">
                      <span className="inline-flex items-center gap-1.5">
                        <ProjectDot id={task.project_id} className="h-2 w-2" />
                        {task.projects?.name ?? "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-ink-soft">
                      {task.board_columns?.name ?? "—"}
                    </td>
                    <td className="px-2 py-2">
                      {taskAssignees.length === 0 ? (
                        <span className="text-ink-soft/50">—</span>
                      ) : (
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
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-2 py-2 ${
                        overdue ? "font-medium text-red-600" : "text-ink-soft"
                      }`}
                    >
                      {task.due_date ? fmtDate(task.due_date) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
