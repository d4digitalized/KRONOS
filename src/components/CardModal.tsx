"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startTimer } from "@/lib/timer";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { PRIORITIES, RECURRENCE_OPTIONS, priorityColor } from "@/lib/priority";
import { projectColor } from "@/components/ProjectPicker";
import Avatar from "@/components/Avatar";
import type { Label, Membership, Recurrence, Task, TaskComment } from "@/lib/types";

/** @tagy v textu komentáře zvýrazní barvou akcentu. */
function CommentBody({ body }: { body: string }) {
  const parts = body.split(/(@[a-z0-9_.]{2,30})/gi);
  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((part, i) =>
        /^@[a-z0-9_.]{2,30}$/i.test(part) ? (
          <span key={i} className="font-medium text-accent">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </p>
  );
}

export default function CardModal({
  task,
  members,
  userId,
  onClose,
  onChanged,
}: {
  task: Task;
  members: Membership[];
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [assignees, setAssignees] = useState<Set<string>>(new Set());
  const [projectMembers, setProjectMembers] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState(task.priority ?? 4);
  const [recurrence, setRecurrence] = useState<string>(task.recurrence ?? "");
  const [done, setDone] = useState(!!task.completed_at);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [taskLabels, setTaskLabels] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadComments = useCallback(async () => {
    const { data } = await supabase
      .from("task_comments")
      .select("*, profiles(full_name, email)")
      .eq("task_id", task.id)
      .order("created_at");
    setComments((data as TaskComment[]) ?? []);
  }, [supabase, task.id]);

  const loadLabels = useCallback(async () => {
    const [allRes, mineRes] = await Promise.all([
      supabase
        .from("labels")
        .select("*")
        .eq("workspace_id", task.workspace_id)
        .order("name"),
      supabase.from("task_labels").select("label_id").eq("task_id", task.id),
    ]);
    setLabels((allRes.data as Label[]) ?? []);
    setTaskLabels(new Set((mineRes.data ?? []).map((r) => r.label_id as string)));
  }, [supabase, task.workspace_id, task.id]);

  const loadSubtasks = useCallback(async () => {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("parent_id", task.id)
      .order("created_at");
    setSubtasks((data as Task[]) ?? []);
  }, [supabase, task.id]);

  const loadAssignees = useCallback(async () => {
    const [mineRes, pmRes] = await Promise.all([
      supabase.from("task_assignees").select("user_id").eq("task_id", task.id),
      supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", task.project_id),
    ]);
    setAssignees(new Set((mineRes.data ?? []).map((r) => r.user_id as string)));
    setProjectMembers(new Set((pmRes.data ?? []).map((r) => r.user_id as string)));
  }, [supabase, task.id, task.project_id]);

  useEffect(() => {
    loadComments();
    loadLabels();
    loadSubtasks();
    loadAssignees();
  }, [loadComments, loadLabels, loadSubtasks, loadAssignees]);

  // přiřadit lze jen členy projektu (admini vidí všechny projekty)
  const assignable = members.filter(
    (m) => projectMembers.has(m.user_id) || m.role === "admin"
  );

  async function toggleAssignee(userId: string) {
    const wasOn = assignees.has(userId);
    setAssignees((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(userId);
      else next.add(userId);
      return next;
    });
    const { error } = wasOn
      ? await supabase
          .from("task_assignees")
          .delete()
          .eq("task_id", task.id)
          .eq("user_id", userId)
      : await supabase
          .from("task_assignees")
          .insert({ task_id: task.id, user_id: userId });
    if (error) {
      toast("Změna řešitele se nezdařila.", "error");
      loadAssignees();
      return;
    }
    if (!wasOn) pingNotifyEmails();
  }

  async function save() {
    const { error } = await supabase
      .from("tasks")
      .update({
        title: title.trim() || task.title,
        description,
        due_date: dueDate || null,
        priority,
        recurrence: (recurrence || null) as Recurrence | null,
        completed_at: done
          ? (task.completed_at ?? new Date().toISOString())
          : null,
      })
      .eq("id", task.id);
    if (error) {
      setError("Uložení se nezdařilo.");
      return;
    }
    pingNotifyEmails(); // dokončení opakované karty přiřazuje další výskyt
    onChanged();
  }

  async function remove() {
    if (!confirm(`Smazat kartu „${task.title}" včetně záznamů času a komentářů?`)) return;
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      setError("Smazat kartu může jen její autor nebo admin.");
      return;
    }
    onChanged();
  }

  // ---------------------------------------------------------------- štítky

  async function toggleLabel(label: Label) {
    const wasOn = taskLabels.has(label.id);
    setTaskLabels((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(label.id);
      else next.add(label.id);
      return next;
    });
    const { error } = wasOn
      ? await supabase
          .from("task_labels")
          .delete()
          .eq("task_id", task.id)
          .eq("label_id", label.id)
      : await supabase
          .from("task_labels")
          .insert({ task_id: task.id, label_id: label.id });
    if (error) {
      toast("Změna štítku se nezdařila.", "error");
      loadLabels();
    }
  }

  async function createLabel(e: React.FormEvent) {
    e.preventDefault();
    const name = newLabel.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("labels")
      .insert({ workspace_id: task.workspace_id, name })
      .select("id")
      .single();
    if (error || !data) {
      toast("Štítek se nepodařilo založit (možná už existuje).", "error");
      return;
    }
    await supabase.from("task_labels").insert({ task_id: task.id, label_id: data.id });
    setNewLabel("");
    setAddingLabel(false);
    loadLabels();
  }

  // ---------------------------------------------------------------- podúkoly

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    const name = newSubtask.trim();
    if (!name) return;
    const { error } = await supabase.from("tasks").insert({
      workspace_id: task.workspace_id,
      project_id: task.project_id,
      parent_id: task.id,
      title: name,
    });
    if (error) {
      toast("Podúkol se nepodařilo přidat.", "error");
      return;
    }
    setNewSubtask("");
    loadSubtasks();
  }

  async function toggleSubtask(sub: Task) {
    await supabase
      .from("tasks")
      .update({ completed_at: sub.completed_at ? null : new Date().toISOString() })
      .eq("id", sub.id);
    loadSubtasks();
  }

  async function removeSubtask(sub: Task) {
    await supabase.from("tasks").delete().eq("id", sub.id);
    loadSubtasks();
  }

  // ---------------------------------------------------------------- komentáře

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    await supabase.from("task_comments").insert({
      workspace_id: task.workspace_id,
      task_id: task.id,
      body: newComment.trim(),
    });
    setNewComment("");
    pingNotifyEmails();
    loadComments();
  }

  async function removeComment(comment: TaskComment) {
    await supabase.from("task_comments").delete().eq("id", comment.id);
    loadComments();
  }

  async function play() {
    await startTimer(supabase, userId, {
      workspace_id: task.workspace_id,
      project_id: task.project_id,
      task_id: task.id,
      task_title: task.title,
    });
    onClose();
  }

  const doneSubtasks = subtasks.filter((s) => s.completed_at).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Karta: ${task.title}`}
        tabIndex={-1}
        className="w-full max-w-lg space-y-4 rounded-xl bg-surface p-5 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => setDone(e.target.checked)}
            className="mt-1.5 h-4 w-4"
            title="Hotovo"
          />
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold hover:border-line focus:border-line"
          />
          <button
            onClick={onClose}
            aria-label="Zavřít kartu"
            className="rounded-md px-2 py-1 text-ink-soft/70 hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Popis…"
          rows={4}
          className="input w-full px-3 py-2"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft/70">Řešitelé:</span>
          {assignable.length === 0 && (
            <span className="text-xs text-ink-soft/50">
              projekt zatím nemá členy
            </span>
          )}
          {assignable.map((m) => {
            const on = assignees.has(m.user_id);
            const name = m.profiles?.full_name || m.profiles?.email || "?";
            return (
              <button
                key={m.user_id}
                onClick={() => toggleAssignee(m.user_id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs transition-colors ${
                  on
                    ? "border-transparent bg-accent text-white"
                    : "border-line text-ink-soft hover:border-ink-soft/40"
                }`}
              >
                <Avatar profile={m.profiles} colorKey={m.user_id} size="xs" />
                {name}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Termín"
            className="input px-2 py-1"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            aria-label="Priorita"
            style={{ color: priorityColor(priority) ?? undefined }}
            className="input px-2"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            aria-label="Opakování"
            className="input px-2"
          >
            {RECURRENCE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            onClick={play}
            className="rounded-md border border-accent/50 px-3 py-1.5 text-sm text-accent hover:bg-accent-soft"
          >
            ▶ Spustit timer
          </button>
        </div>
        {recurrence && (
          <p className="text-xs text-ink-soft/70">
            Po dokončení se automaticky založí další výskyt s posunutým termínem.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {labels.map((label) => {
            const on = taskLabels.has(label.id);
            return (
              <button
                key={label.id}
                onClick={() => toggleLabel(label)}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  on
                    ? "border-transparent text-white"
                    : "border-line text-ink-soft hover:border-ink-soft/40"
                }`}
                style={on ? { background: projectColor(label.id) } : undefined}
              >
                {label.name}
              </button>
            );
          })}
          {addingLabel ? (
            <form onSubmit={createLabel} className="inline-flex gap-1">
              <input
                autoFocus
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onBlur={() => !newLabel.trim() && setAddingLabel(false)}
                placeholder="Název štítku…"
                className="input w-32 px-2 py-0.5 text-xs"
              />
              <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
                OK
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAddingLabel(true)}
              className="rounded-full px-2 py-0.5 text-xs text-ink-soft/70 hover:bg-black/5"
            >
              + štítek
            </button>
          )}
        </div>

        <div className="space-y-1.5 border-t border-line/70 pt-3">
          <h3 className="text-sm font-semibold">
            Podúkoly
            {subtasks.length > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-soft/70">
                {doneSubtasks}/{subtasks.length}
              </span>
            )}
          </h3>
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!sub.completed_at}
                onChange={() => toggleSubtask(sub)}
                className="h-3.5 w-3.5"
              />
              <span
                className={`flex-1 text-sm ${
                  sub.completed_at ? "text-ink-soft/70 line-through" : ""
                }`}
              >
                {sub.title}
              </span>
              <button
                onClick={() => removeSubtask(sub)}
                aria-label={`Smazat podúkol ${sub.title}`}
                className="rounded px-1.5 text-xs text-ink-soft/50 hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
          <form onSubmit={addSubtask} className="flex gap-2">
            <input
              type="text"
              placeholder="+ Přidat podúkol…"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              className="input-quiet flex-1 px-2 py-1 text-sm"
            />
            {newSubtask.trim() && (
              <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
                OK
              </button>
            )}
          </form>
        </div>

        <div className="space-y-2 border-t border-line/70 pt-3">
          <h3 className="text-sm font-semibold">Komentáře</h3>
          {comments.length === 0 && (
            <p className="text-xs text-ink-soft/70">Zatím žádné komentáře.</p>
          )}
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-lg bg-paper p-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium">
                  {comment.profiles?.full_name || comment.profiles?.email}
                </span>
                <span className="text-[10px] text-ink-soft/70">
                  {new Date(comment.created_at).toLocaleString("cs-CZ", {
                    day: "numeric",
                    month: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {comment.author_id === userId && (
                  <button
                    onClick={() => removeComment(comment)}
                    className="ml-auto text-[10px] text-ink-soft/70 hover:text-danger"
                  >
                    smazat
                  </button>
                )}
              </div>
              <CommentBody body={comment.body} />
            </div>
          ))}
          <form onSubmit={addComment} className="flex gap-2">
            <input
              type="text"
              placeholder="Napsat komentář…"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="flex-1 input"
            />
            <button
              type="submit"
              className="btn-primary"
            >
              Odeslat
            </button>
          </form>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between border-t border-line/70 pt-3">
          <button
            onClick={remove}
            className="rounded-md px-2 py-1 text-sm text-danger hover:bg-danger/10"
          >
            Smazat kartu
          </button>
          <button
            onClick={save}
            className="btn-primary"
          >
            Uložit
          </button>
        </div>
      </div>
    </div>
  );
}
