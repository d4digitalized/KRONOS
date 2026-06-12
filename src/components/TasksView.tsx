"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtClock, entrySeconds } from "@/lib/format";
import type { Membership, Project, Task, TimeEntry } from "@/lib/types";
import TaskRow from "@/components/TaskRow";

export default function TasksView({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();

  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completed, setCompleted] = useState<Task[]>([]);
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [onlyMine, setOnlyMine] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // quick add
  const [newTitle, setNewTitle] = useState("");
  const [newProject, setNewProject] = useState("");
  const [newAssignee, setNewAssignee] = useState(userId);
  const [newDue, setNewDue] = useState("");

  const load = useCallback(async () => {
    const [projRes, memRes, taskRes, runRes] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("archived", false)
        .order("name"),
      supabase
        .from("workspace_members")
        .select("user_id, role, profiles(id, email, full_name, is_super_admin)")
        .eq("workspace_id", wsId),
      supabase
        .from("tasks")
        .select("*, projects(name)")
        .eq("workspace_id", wsId)
        .is("completed_at", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("time_entries")
        .select("*, tasks(title, workspace_id)")
        .eq("user_id", userId)
        .is("stopped_at", null)
        .maybeSingle(),
    ]);
    setProjects((projRes.data as Project[]) ?? []);
    setMembers((memRes.data as unknown as Membership[]) ?? []);
    setTasks((taskRes.data as Task[]) ?? []);
    setRunning((runRes.data as TimeEntry) ?? null);
    setLoading(false);
  }, [supabase, wsId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!showCompleted) return;
    supabase
      .from("tasks")
      .select("*, projects(name)")
      .eq("workspace_id", wsId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setCompleted((data as Task[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompleted, tasks.length, wsId]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newProject) return;
    const { error } = await supabase.from("tasks").insert({
      workspace_id: wsId,
      project_id: newProject,
      title: newTitle.trim(),
      assignee_id: newAssignee || null,
      due_date: newDue || null,
    });
    if (!error) {
      setNewTitle("");
      setNewDue("");
      load();
    }
  }

  async function startTimer(task: Task) {
    if (running) {
      await supabase
        .from("time_entries")
        .update({ stopped_at: new Date().toISOString() })
        .eq("id", running.id);
    }
    await supabase.from("time_entries").insert({
      workspace_id: task.workspace_id,
      task_id: task.id,
      user_id: userId,
    });
    load();
  }

  async function stopTimer() {
    if (!running) return;
    await supabase
      .from("time_entries")
      .update({ stopped_at: new Date().toISOString() })
      .eq("id", running.id);
    setRunning(null);
  }

  async function toggleComplete(task: Task) {
    await supabase
      .from("tasks")
      .update({ completed_at: task.completed_at ? null : new Date().toISOString() })
      .eq("id", task.id);
    load();
  }

  const visibleTasks = onlyMine
    ? tasks.filter((t) => t.assignee_id === userId)
    : tasks;

  if (loading) return <p className="p-4 text-neutral-400">Načítám…</p>;

  return (
    <div className="space-y-4">
      {running && (
        <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 p-3">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {running.tasks?.title ?? "Úkol"}
            </p>
          </div>
          <span className="font-mono text-lg tabular-nums" data-tick={tick}>
            {fmtClock(entrySeconds(running.started_at, null))}
          </span>
          <button
            onClick={stopTimer}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            Stop
          </button>
        </div>
      )}

      <form
        onSubmit={addTask}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3"
      >
        <input
          type="text"
          placeholder="Nový úkol…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="min-w-40 flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <select
          required
          value={newProject}
          onChange={(e) => setNewProject(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">Projekt…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={newAssignee}
          onChange={(e) => setNewAssignee(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">Nepřiřazeno</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profiles?.full_name || m.profiles?.email}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={newDue}
          onChange={(e) => setNewDue(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Přidat
        </button>
      </form>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setOnlyMine(true)}
          className={`rounded-md px-3 py-1 text-sm ${onlyMine ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 border border-neutral-200"}`}
        >
          Moje úkoly
        </button>
        <button
          onClick={() => setOnlyMine(false)}
          className={`rounded-md px-3 py-1 text-sm ${!onlyMine ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 border border-neutral-200"}`}
        >
          Všechny
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-neutral-500">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
          />
          Zobrazit hotové
        </label>
      </div>

      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
        {visibleTasks.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">
            Žádné úkoly. Přidej první nahoře.
          </p>
        )}
        {visibleTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            projects={projects}
            members={members}
            isRunning={running?.task_id === task.id}
            onToggleComplete={() => toggleComplete(task)}
            onStart={() => startTimer(task)}
            onChanged={load}
          />
        ))}
      </div>

      {showCompleted && completed.length > 0 && (
        <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white opacity-70">
          {completed.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projects={projects}
              members={members}
              isRunning={false}
              onToggleComplete={() => toggleComplete(task)}
              onStart={() => startTimer(task)}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
