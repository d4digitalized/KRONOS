"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dayKey, entrySeconds, fmtDuration, fmtTime } from "@/lib/format";
import type { Task, TimeEntry } from "@/lib/types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MyTimeView({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editStop, setEditStop] = useState("");

  // ruční zápis
  const [addTask, setAddTask] = useState("");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addFrom, setAddFrom] = useState("09:00");
  const [addTo, setAddTo] = useState("10:00");
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const [entriesRes, tasksRes] = await Promise.all([
      supabase
        .from("time_entries")
        .select("*, tasks(title, projects(name))")
        .eq("workspace_id", wsId)
        .eq("user_id", userId)
        .gte("started_at", since.toISOString())
        .order("started_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, title, projects(name)")
        .eq("workspace_id", wsId)
        .is("completed_at", null)
        .order("created_at", { ascending: false }),
    ]);
    setEntries((entriesRes.data as TimeEntry[]) ?? []);
    setTasks((tasksRes.data as unknown as Task[]) ?? []);
    setLoading(false);
  }, [supabase, wsId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!addTask) return;
    const started = new Date(`${addDate}T${addFrom}`);
    const stopped = new Date(`${addDate}T${addTo}`);
    if (stopped <= started) {
      setAddError("Konec musí být po začátku.");
      return;
    }
    const { error } = await supabase.from("time_entries").insert({
      workspace_id: wsId,
      task_id: addTask,
      user_id: userId,
      started_at: started.toISOString(),
      stopped_at: stopped.toISOString(),
    });
    if (error) {
      setAddError("Uložení se nezdařilo.");
      return;
    }
    load();
  }

  function startEdit(entry: TimeEntry) {
    setEditingId(entry.id);
    setEditStart(toLocalInput(entry.started_at));
    setEditStop(entry.stopped_at ? toLocalInput(entry.stopped_at) : "");
  }

  async function saveEdit(entry: TimeEntry) {
    const started = new Date(editStart);
    const stopped = editStop ? new Date(editStop) : null;
    if (stopped && stopped <= started) return;
    await supabase
      .from("time_entries")
      .update({
        started_at: started.toISOString(),
        stopped_at: stopped ? stopped.toISOString() : entry.stopped_at,
      })
      .eq("id", entry.id);
    setEditingId(null);
    load();
  }

  async function remove(entry: TimeEntry) {
    if (!confirm("Smazat tento záznam času?")) return;
    await supabase.from("time_entries").delete().eq("id", entry.id);
    load();
  }

  if (loading) return <p className="p-4 text-neutral-400">Načítám…</p>;

  const byDay = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.started_at);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={addEntry}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3"
      >
        <select
          required
          value={addTask}
          onChange={(e) => setAddTask(e.target.value)}
          className="min-w-40 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">Úkol…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.projects?.name})
            </option>
          ))}
        </select>
        <input
          type="date"
          required
          value={addDate}
          onChange={(e) => setAddDate(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          type="time"
          required
          value={addFrom}
          onChange={(e) => setAddFrom(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <span className="text-neutral-400">–</span>
        <input
          type="time"
          required
          value={addTo}
          onChange={(e) => setAddTo(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Zapsat čas
        </button>
        {addError && <p className="w-full text-sm text-red-600">{addError}</p>}
      </form>

      {entries.length === 0 && (
        <p className="p-4 text-sm text-neutral-400">
          Za posledních 30 dní tu nejsou žádné záznamy.
        </p>
      )}

      {[...byDay.entries()].map(([day, dayEntries]) => {
        const total = dayEntries.reduce(
          (sum, e) => sum + (e.stopped_at ? entrySeconds(e.started_at, e.stopped_at) : 0),
          0
        );
        return (
          <div key={day} className="rounded-xl border border-neutral-200 bg-white">
            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
              <span className="text-sm font-medium">
                {new Date(`${day}T00:00`).toLocaleDateString("cs-CZ", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </span>
              <span className="font-mono text-sm text-neutral-500">
                {fmtDuration(total)} h
              </span>
            </div>
            <div className="divide-y divide-neutral-50">
              {dayEntries.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{entry.tasks?.title}</p>
                    <p className="text-xs text-neutral-400">
                      {entry.tasks?.projects?.name}
                    </p>
                  </div>
                  {editingId === entry.id ? (
                    <>
                      <input
                        type="datetime-local"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        className="rounded-md border border-neutral-300 px-1 py-0.5 text-xs"
                      />
                      {entry.stopped_at && (
                        <input
                          type="datetime-local"
                          value={editStop}
                          onChange={(e) => setEditStop(e.target.value)}
                          className="rounded-md border border-neutral-300 px-1 py-0.5 text-xs"
                        />
                      )}
                      <button
                        onClick={() => saveEdit(entry)}
                        className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white"
                      >
                        Uložit
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-md px-2 py-1 text-xs text-neutral-500"
                      >
                        Zrušit
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-neutral-500">
                        {fmtTime(entry.started_at)}
                        {" – "}
                        {entry.stopped_at ? fmtTime(entry.stopped_at) : "běží"}
                      </span>
                      <span className="font-mono text-sm tabular-nums">
                        {entry.stopped_at
                          ? fmtDuration(entrySeconds(entry.started_at, entry.stopped_at))
                          : "•"}
                      </span>
                      <button
                        onClick={() => startEdit(entry)}
                        className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                      >
                        Upravit
                      </button>
                      <button
                        onClick={() => remove(entry)}
                        className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Smazat
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
