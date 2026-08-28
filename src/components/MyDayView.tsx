"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { fmtClock } from "@/lib/format";
import { syncTaskCalendar } from "@/app/actions/calendar";
import { ProjectDot, projectColor } from "@/components/ProjectPicker";
import type { Task } from "@/lib/types";

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DAY_LABEL = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

type PlannedTask = Task & {
  workspaces?: { name: string } | null;
  task_assignees?: { user_id: string }[];
};

/** Můj den: agenda naplánovaných oken (stejná data jako kalendář KRONOS)
    napříč všemi firmami + termíny dne. Plán se edituje na kartě úkolu,
    tady se jen čte — klik vede přes /t/<id> rovnou na kartu. */
export default function MyDayView({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [planned, setPlanned] = useState<PlannedTask[]>([]);
  const [due, setDue] = useState<PlannedTask[]>([]);
  // pravý sloupec: kandidáti k naplánování + hledání + rychlé založení
  const [candidates, setCandidates] = useState<PlannedTask[]>([]);
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [planFrom, setPlanFrom] = useState("09:00");
  const [planTo, setPlanTo] = useState("10:00");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(async () => {
    const fromISO = weekStart.toISOString();
    const toISO = weekEnd.toISOString();
    const fromDay = isoDay(weekStart);
    const toDay = isoDay(weekEnd);
    const [mineRes, createdRes, dueRes, candRes] = await Promise.all([
      // naplánované úkoly, kde jsem řešitel (napříč firmami)
      supabase
        .from("task_assignees")
        .select(
          "tasks!inner(*, projects(name), workspaces(name), task_assignees(user_id))"
        )
        .eq("user_id", userId)
        .gte("tasks.planned_start", fromISO)
        .lt("tasks.planned_start", toISO),
      // naplánované úkoly bez řešitele, které jsem založil (plánuje autor)
      supabase
        .from("tasks")
        .select("*, projects(name), workspaces(name), task_assignees(user_id)")
        .eq("created_by", userId)
        .gte("planned_start", fromISO)
        .lt("planned_start", toISO),
      // termíny v týdnu (bez naplánovaných — ty už jsou na ose)
      supabase
        .from("task_assignees")
        .select("tasks!inner(*, projects(name), workspaces(name))")
        .eq("user_id", userId)
        .is("tasks.completed_at", null)
        .is("tasks.planned_start", null)
        .gte("tasks.due_date", fromDay)
        .lt("tasks.due_date", toDay),
      // kandidáti k naplánování: moje otevřené úkoly bez plánu (všechny firmy)
      supabase
        .from("task_assignees")
        .select("tasks!inner(*, projects(name), workspaces(name))")
        .eq("user_id", userId)
        .is("tasks.completed_at", null)
        .is("tasks.planned_start", null)
        .is("tasks.parent_id", null),
    ]);
    const mine = ((mineRes.data ?? []) as unknown as { tasks: PlannedTask }[]).map(
      (r) => r.tasks
    );
    const created = ((createdRes.data ?? []) as unknown as PlannedTask[]).filter(
      (t) => (t.task_assignees ?? []).length === 0
    );
    const byId = new Map<string, PlannedTask>();
    for (const t of [...mine, ...created]) byId.set(t.id, t);
    setPlanned(
      [...byId.values()].sort((a, b) =>
        (a.planned_start ?? "").localeCompare(b.planned_start ?? "")
      )
    );
    setDue(
      ((dueRes.data ?? []) as unknown as { tasks: PlannedTask }[]).map(
        (r) => r.tasks
      )
    );
    setCandidates(
      ((candRes.data ?? []) as unknown as { tasks: PlannedTask }[])
        .map((r) => r.tasks)
        .filter((t) => !t.on_hold)
        .sort(
          (a, b) =>
            (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
            (a.priority ?? 4) - (b.priority ?? 4) ||
            a.title.localeCompare(b.title, "cs")
        )
    );
    setLoading(false);
  }, [supabase, userId, weekStart, weekEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const today = isoDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const plannedCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of planned) {
      const key = isoDay(new Date(t.planned_start!));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [planned]);

  const dayPlanned = planned.filter(
    (t) => isoDay(new Date(t.planned_start!)) === day
  );
  const dayDue = due.filter((t) => t.due_date === day);
  const totalSeconds = dayPlanned.reduce(
    (sum, t) =>
      sum +
      (new Date(t.planned_end!).getTime() - new Date(t.planned_start!).getTime()) /
        1000,
    0
  );
  const nowISO = new Date().toISOString();

  /** Rozbalení plánovací nabídky u úkolu — od kdy: za poslední okno dne. */
  function openPlan(taskId: string) {
    if (planFor === taskId) {
      setPlanFor(null);
      return;
    }
    const last = dayPlanned[dayPlanned.length - 1];
    const start = last ? new Date(last.planned_end!) : new Date(`${day}T09:00`);
    if (start.getHours() < 8) start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setPlanFrom(hhmm(start.toISOString()));
    setPlanTo(hhmm(end.toISOString()));
    setPlanFor(taskId);
  }

  /** Zapíše plán na vybraný den a propíše ho do kalendáře. */
  async function planTask(task: PlannedTask) {
    if (busy) return;
    if (!planFrom || !planTo || planTo <= planFrom) {
      toast("Konec plánu musí být po začátku.", "error");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("tasks")
      .update({
        planned_start: new Date(`${day}T${planFrom}`).toISOString(),
        planned_end: new Date(`${day}T${planTo}`).toISOString(),
      })
      .eq("id", task.id);
    if (error) {
      setBusy(false);
      toast("Naplánování se nezdařilo.", "error");
      return;
    }
    const res = await syncTaskCalendar(task.id);
    if (res.error) toast(res.error, "error");
    else toast(`Naplánováno: ${task.title} (${planFrom}–${planTo})`);
    setPlanFor(null);
    setBusy(false);
    load();
  }

  /** Rychlé založení úkolu (aktuální firma, řešitel já, rovnou zatříděný). */
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: wsId,
        title,
        triaged_at: new Date().toISOString(), // vědomě založený — nepatří do Inboxu
      })
      .select("id")
      .single();
    if (error || !data) {
      setBusy(false);
      toast("Úkol se nepodařilo přidat.", "error");
      return;
    }
    await supabase
      .from("task_assignees")
      .insert({ task_id: data.id, user_id: userId });
    setNewTitle("");
    setBusy(false);
    toast(`Úkol přidán: ${title} — teď ho naplánuj.`);
    load();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const q = query.trim().toLowerCase();
  const results = (
    q
      ? candidates.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.projects?.name ?? "").toLowerCase().includes(q)
        )
      : candidates
  ).slice(0, 20);

  return (
    <div className="mx-auto grid w-full max-w-6xl items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="font-display text-lg font-semibold">Můj den</h1>
        <p className="text-xs text-ink-soft/70">
          {new Date(`${day}T00:00`).toLocaleDateString("cs-CZ", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {dayPlanned.length > 0 && (
            <>
              {" · "}naplánováno {dayPlanned.length}{" "}
              {dayPlanned.length === 1 ? "úkol" : dayPlanned.length < 5 ? "úkoly" : "úkolů"}{" "}
              · <span className="font-mono">{fmtClock(totalSeconds)}</span> h
            </>
          )}
        </p>
      </div>

      {/* pruh dnů — jako v Denním výkazu */}
      <div className="flex items-center gap-1.5 panel p-2">
        <button
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          aria-label="Předchozí týden"
          className="rounded-md px-2 py-1 text-ink-soft hover:bg-black/5"
        >
          ‹
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
          {days.map((d, i) => {
            const key = isoDay(d);
            const n = plannedCount.get(key) ?? 0;
            const selected = key === day;
            return (
              <button
                key={key}
                onClick={() => setDay(key)}
                aria-pressed={selected}
                className={`flex flex-col items-center rounded-lg px-1 py-1.5 text-xs transition-colors ${
                  selected ? "bg-accent text-white" : "hover:bg-black/5"
                }`}
              >
                <span
                  className={
                    selected
                      ? ""
                      : key === today
                        ? "font-semibold"
                        : "text-ink-soft/70"
                  }
                >
                  {DAY_LABEL[i]} {d.getDate()}.
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    selected
                      ? "text-white/80"
                      : n > 0
                        ? "text-accent"
                        : "text-ink-soft/40"
                  }`}
                >
                  {n > 0 ? n : "—"}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          aria-label="Další týden"
          className="rounded-md px-2 py-1 text-ink-soft hover:bg-black/5"
        >
          ›
        </button>
      </div>

      {/* časová osa naplánovaných oken */}
      {dayPlanned.length === 0 ? (
        <p className="panel p-8 text-center text-sm text-ink-soft/70">
          Na tenhle den nemáš nic naplánované. Okno nastavíš na kartě úkolu
          (🗓 Plán) — propíše se sem i do kalendáře.
        </p>
      ) : (
        <div className="divide-y divide-line/50 panel">
          {dayPlanned.map((t) => {
            const active =
              !t.completed_at &&
              t.planned_start! <= nowISO &&
              nowISO < t.planned_end!;
            const past = t.planned_end! < nowISO;
            return (
              <Link
                key={t.id}
                href={`/t/${t.id}`}
                className={`flex items-center gap-3 px-3 py-2.5 hover:bg-black/[.02] ${
                  past && !active ? "opacity-60" : ""
                }`}
              >
                <span
                  aria-hidden
                  style={{ background: projectColor(t.workspace_id) }}
                  className="h-9 w-1 shrink-0 rounded-full"
                />
                <span
                  className={`w-24 shrink-0 font-mono text-sm tabular-nums ${
                    active ? "font-semibold text-accent" : "text-ink-soft"
                  }`}
                >
                  {hhmm(t.planned_start!)}–{hhmm(t.planned_end!)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${
                      t.completed_at ? "text-ink-soft/60 line-through" : ""
                    }`}
                  >
                    {t.title}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-soft/70">
                    <span className="font-medium">{t.workspaces?.name}</span>
                    <span aria-hidden>·</span>
                    <ProjectDot id={t.project_id} className="h-2 w-2" />
                    <span className="truncate">
                      {t.projects?.name ?? "Bez projektu"}
                    </span>
                  </span>
                </span>
                {active && (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                    teď
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* termíny dne (nenaplánované) */}
      {dayDue.length > 0 && (
        <div className="panel">
          <h2 className="border-b border-line/70 px-3 py-2 text-sm font-semibold">
            Termín dnes{" "}
            <span className="text-xs font-normal text-ink-soft/60">
              {dayDue.length} · bez naplánovaného času
            </span>
          </h2>
          <div className="divide-y divide-line/50">
            {dayDue.map((t) => (
              <Link
                key={t.id}
                href={`/t/${t.id}`}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-black/[.02]"
              >
                <span
                  aria-hidden
                  style={{ background: projectColor(t.workspace_id) }}
                  className="h-7 w-1 shrink-0 rounded-full"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.title}</span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-soft/70">
                    <span className="font-medium">{t.workspaces?.name}</span>
                    <span aria-hidden>·</span>
                    <ProjectDot id={t.project_id} className="h-2 w-2" />
                    <span className="truncate">
                      {t.projects?.name ?? "Bez projektu"}
                    </span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* pravý sloupec: najít / založit úkol a naplánovat ho na vybraný den */}
    <aside className="panel space-y-3 p-3">
      <h2 className="text-sm font-semibold">Naplánovat úkol</h2>

      <form onSubmit={addTask} className="flex gap-1.5">
        <input
          type="text"
          placeholder="Nový úkol…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="input min-w-0 flex-1 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !newTitle.trim()}
          className="btn-primary shrink-0 px-3 py-1 text-sm disabled:opacity-60"
        >
          +
        </button>
      </form>

      <input
        type="search"
        placeholder="Hledat v mých úkolech…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="input w-full px-2 py-1.5 text-sm"
      />

      {results.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-soft/60">
          {q ? "Nic nenalezeno." : "Žádné nenaplánované úkoly. 🎉"}
        </p>
      ) : (
        <div className="-mx-1 max-h-[26rem] space-y-0.5 overflow-y-auto px-1">
          {results.map((t) => {
            const open = planFor === t.id;
            return (
              <div
                key={t.id}
                className={`rounded-lg ${open ? "bg-accent-soft/50" : "hover:bg-black/[.03]"}`}
              >
                <button
                  onClick={() => openPlan(t.id)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                >
                  <span
                    aria-hidden
                    style={{ background: projectColor(t.workspace_id) }}
                    className="h-6 w-1 shrink-0 rounded-full"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="flex items-center gap-1 text-[11px] text-ink-soft/70">
                      <span className="font-medium">{t.workspaces?.name}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">
                        {t.projects?.name ?? "Bez projektu"}
                      </span>
                      {t.due_date && (
                        <span className="ml-auto shrink-0">
                          do{" "}
                          {new Date(`${t.due_date}T00:00`).toLocaleDateString(
                            "cs-CZ",
                            { day: "numeric", month: "numeric" }
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="flex items-center gap-1.5 px-2 pb-2">
                    <input
                      type="time"
                      value={planFrom}
                      onChange={(e) => setPlanFrom(e.target.value)}
                      aria-label="Plán od"
                      className="input px-1.5 py-1 text-xs"
                    />
                    <span className="text-ink-soft/50">–</span>
                    <input
                      type="time"
                      value={planTo}
                      onChange={(e) => setPlanTo(e.target.value)}
                      aria-label="Plán do"
                      className="input px-1.5 py-1 text-xs"
                    />
                    <button
                      onClick={() => planTask(t)}
                      disabled={busy}
                      className="btn-primary ml-auto px-2.5 py-1 text-xs disabled:opacity-60"
                    >
                      {DAY_LABEL[(new Date(`${day}T00:00`).getDay() + 6) % 7]}{" "}
                      {new Date(`${day}T00:00`).getDate()}. ✓
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
    </div>
  );
}
