"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Membership, Project, Task } from "@/lib/types";

export default function TaskRow({
  task,
  projects,
  members,
  isRunning,
  onToggleComplete,
  onStart,
  onChanged,
}: {
  task: Task;
  projects: Project[];
  members: Membership[];
  isRunning: boolean;
  onToggleComplete: () => void;
  onStart: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [projectId, setProjectId] = useState(task.project_id);
  const [assigneeId, setAssigneeId] = useState(task.assignee_id ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");

  const assignee = members.find((m) => m.user_id === task.assignee_id);
  const isDone = !!task.completed_at;
  const overdue =
    !isDone && task.due_date && task.due_date < new Date().toISOString().slice(0, 10);

  async function save() {
    await supabase
      .from("tasks")
      .update({
        title: title.trim() || task.title,
        description,
        project_id: projectId,
        assignee_id: assigneeId || null,
        due_date: dueDate || null,
      })
      .eq("id", task.id);
    setOpen(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Smazat úkol „${task.title}" včetně záznamů času?`)) return;
    await supabase.from("tasks").delete().eq("id", task.id);
    onChanged();
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={isDone}
          onChange={onToggleComplete}
          className="h-4 w-4"
        />
        <button
          onClick={() => setOpen(!open)}
          className={`min-w-0 flex-1 truncate text-left text-sm ${isDone ? "text-neutral-400 line-through" : ""}`}
        >
          {task.title}
        </button>
        <span className="hidden rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 sm:inline">
          {task.projects?.name}
        </span>
        {task.due_date && (
          <span className={`text-xs ${overdue ? "font-medium text-red-600" : "text-neutral-400"}`}>
            {new Date(task.due_date).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}
          </span>
        )}
        {assignee && (
          <span className="hidden text-xs text-neutral-400 sm:inline">
            {assignee.profiles?.full_name || assignee.profiles?.email}
          </span>
        )}
        {!isDone &&
          (isRunning ? (
            <span className="text-xs font-medium text-green-600">běží…</span>
          ) : (
            <button
              onClick={onStart}
              title="Spustit timer"
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-green-50 hover:border-green-300"
            >
              ▶
            </button>
          ))}
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-neutral-50 p-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Popis…"
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
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
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
            <button
              onClick={save}
              className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700"
            >
              Uložit
            </button>
            <button
              onClick={remove}
              className="ml-auto rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50"
            >
              Smazat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
