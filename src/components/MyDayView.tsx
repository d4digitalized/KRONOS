"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtClock } from "@/lib/format";
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
export default function MyDayView({ userId }: { userId: string }) {
  const supabase = createClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [planned, setPlanned] = useState<PlannedTask[]>([]);
  const [due, setDue] = useState<PlannedTask[]>([]);
  const [loading, setLoading] = useState(true);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(async () => {
    const fromISO = weekStart.toISOString();
    const toISO = weekEnd.toISOString();
    const fromDay = isoDay(weekStart);
    const toDay = isoDay(weekEnd);
    const [mineRes, createdRes, dueRes] = await Promise.all([
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

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  return (
    <div className="w-full max-w-3xl space-y-4">
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
  );
}
