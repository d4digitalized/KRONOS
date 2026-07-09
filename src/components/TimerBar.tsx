"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entrySeconds, fmtClock } from "@/lib/format";
import {
  startTimer,
  stopRunningTimer,
  updateRunningEntry,
  TIMER_CHANGED_EVENT,
} from "@/lib/timer";
import ProjectPicker, { ProjectDot } from "@/components/ProjectPicker";
import NotificationsBell from "@/components/NotificationsBell";
import type { Project, TimeEntry } from "@/lib/types";

/** Odlehčený úkol pro našeptávač v liště. */
type TaskLite = {
  id: string;
  title: string;
  project_id: string | null;
  projects: { name: string } | null;
};

export default function TimerBar({
  wsId,
  userId,
}: {
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [description, setDescription] = useState("");
  const [idleProject, setIdleProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  // našeptávač přiřazených úkolů
  const [myTasks, setMyTasks] = useState<TaskLite[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const suggestRef = useRef<HTMLDivElement>(null);
  // start/stop probíhá — blokuje dvojklik i externí reload, aby optimistický
  // stav nepřeblikával. Ref (ne state), ať ho vidí i listenery bez re-subscribe.
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("time_entries")
      .select("*, tasks(title), projects(name)")
      .eq("user_id", userId)
      .is("stopped_at", null)
      .maybeSingle();
    setRunning((data as TimeEntry) ?? null);
  }, [supabase, userId]);

  useEffect(() => {
    load();
    // reload při vlastní změně timeru i při návratu na stránku. Pokrýváme
    // focus (přepnutí okna), visibilitychange (přepnutí tabu) a pageshow
    // (obnova z bfcache — mobilní tlačítko Zpět). Během vlastního start/stop
    // reload přeskočíme, ať optimistický stav nepřebliká zpět.
    const onChange = () => {
      if (busyRef.current) return;
      load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onChange();
    };
    window.addEventListener(TIMER_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    window.addEventListener("pageshow", onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(TIMER_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
      window.removeEventListener("pageshow", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", wsId)
      .eq("archived", false)
      .order("position")
      .order("name")
      .then(({ data }) => setProjects((data as Project[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // úkoly přiřazené přihlášenému uživateli — zdroj pro našeptávač
  const loadMyTasks = useCallback(async () => {
    const { data } = await supabase
      .from("task_assignees")
      .select("tasks!inner(id, title, project_id, projects(name))")
      .eq("user_id", userId)
      .eq("tasks.workspace_id", wsId)
      .is("tasks.completed_at", null)
      .is("tasks.parent_id", null);
    const tasks = ((data ?? []) as unknown as { tasks: TaskLite }[])
      .map((r) => r.tasks)
      .sort((a, b) => a.title.localeCompare(b.title, "cs"));
    setMyTasks(tasks);
  }, [supabase, wsId, userId]);

  useEffect(() => {
    loadMyTasks();
    const onChange = () => loadMyTasks();
    window.addEventListener(TIMER_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TIMER_CHANGED_EVENT, onChange);
  }, [loadMyTasks]);

  // zavření našeptávače kliknutím mimo
  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!suggestRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [suggestOpen]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // popis editujeme lokálně, do DB se ukládá až na blur/Enter
  const runningId = running?.id;
  useEffect(() => {
    setDescription(running?.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningId]);

  const isTaskEntry = !!running?.task_id;

  async function start() {
    if (busyRef.current || running) return;
    busyRef.current = true;
    setBusy(true);
    const projectId = idleProject || null;
    // optimisticky přepni na „běží" hned, ať má uživatel okamžitou odezvu
    setRunning({
      id: "optimistic",
      workspace_id: wsId,
      user_id: userId,
      project_id: projectId,
      task_id: null,
      description: description.trim(),
      started_at: new Date().toISOString(),
      stopped_at: null,
    } as unknown as TimeEntry);
    await startTimer(supabase, userId, {
      workspace_id: wsId,
      project_id: projectId,
      description: description.trim(),
    });
    setIdleProject("");
    await load(); // sesynchronizuj skutečný záznam (id, přesný started_at)
    busyRef.current = false;
    setBusy(false);
  }

  // spustí timer rovnou na vybraném přiřazeném úkolu
  async function pickTask(task: TaskLite) {
    setSuggestOpen(false);
    setHighlight(-1);
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDescription("");
    setRunning({
      id: "optimistic",
      workspace_id: wsId,
      user_id: userId,
      project_id: task.project_id,
      task_id: task.id,
      description: "",
      started_at: new Date().toISOString(),
      stopped_at: null,
      tasks: { title: task.title },
      projects: task.projects,
    } as unknown as TimeEntry);
    await startTimer(supabase, userId, {
      workspace_id: wsId,
      project_id: task.project_id,
      task_id: task.id,
      task_title: task.title,
    });
    setIdleProject("");
    await load();
    busyRef.current = false;
    setBusy(false);
  }

  async function stop() {
    if (busyRef.current || !running) return;
    busyRef.current = true;
    setBusy(true);
    setRunning(null); // optimisticky; při chybě to load() vrátí zpět
    await stopRunningTimer(supabase, userId);
    await load();
    busyRef.current = false;
    setBusy(false);
  }

  async function saveDescription() {
    if (!running || description.trim() === running.description) return;
    await updateRunningEntry(supabase, running.id, {
      description: description.trim(),
    });
  }

  const q = description.trim().toLowerCase();
  const suggestions = (
    q ? myTasks.filter((t) => t.title.toLowerCase().includes(q)) : myTasks
  ).slice(0, 8);
  const showSuggest = suggestOpen && suggestions.length > 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      {/* jeden řádek i na mobilu — zalomení řešíme zmenšením popisu, ne wrapem */}
      <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        {isTaskEntry && running ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {running.tasks?.title || running.description || "Měřím čas"}
            </p>
            <p className="truncate text-xs text-ink-soft">
              {running.projects?.name}
            </p>
          </div>
        ) : (
          <>
            <div ref={suggestRef} className="relative -ml-2 min-w-0 flex-1 sm:min-w-40">
              <input
                type="text"
                placeholder="Na čem děláš?"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setSuggestOpen(true);
                  setHighlight(-1);
                }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={running ? saveDescription : undefined}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && suggestions.length) {
                    e.preventDefault();
                    setSuggestOpen(true);
                    setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp" && showSuggest) {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                    return;
                  }
                  if (e.key === "Escape" && showSuggest) {
                    setSuggestOpen(false);
                    setHighlight(-1);
                    return;
                  }
                  if (e.key !== "Enter") return;
                  if (showSuggest && highlight >= 0) {
                    e.preventDefault();
                    pickTask(suggestions[highlight]);
                    return;
                  }
                  if (running) e.currentTarget.blur();
                  else start();
                }}
                className="input-quiet w-full px-2 py-1.5 text-base"
              />
              {showSuggest && (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
                  {suggestions.map((t, i) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickTask(t)}
                        onMouseEnter={() => setHighlight(i)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                          i === highlight ? "bg-accent-soft/60" : "hover:bg-black/[.03]"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-ink-soft/70">
                          <ProjectDot id={t.project_id} className="h-2 w-2" />
                          {t.projects?.name ?? "—"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="shrink-0">
              <ProjectPicker
                projects={projects}
                value={running ? running.project_id : idleProject || null}
                onChange={(projectId) =>
                  running
                    ? updateRunningEntry(supabase, running.id, {
                        project_id: projectId,
                      })
                    : setIdleProject(projectId ?? "")
                }
                hideLabelOnMobile
              />
            </div>
          </>
        )}

        <span
          className={`shrink-0 font-mono text-base font-semibold tabular-nums sm:text-lg ${
            running ? "text-brass" : "text-ink-soft/50"
          }`}
        >
          {running ? fmtClock(entrySeconds(running.started_at, null)) : "0:00:00"}
        </span>

        {running ? (
          <button
            onClick={stop}
            disabled={busy}
            aria-label="Zastavit timer a uložit záznam"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm hover:bg-red-500 disabled:opacity-60"
          >
            <span className="block h-3.5 w-3.5 rounded-[2px] bg-current" />
          </button>
        ) : (
          <button
            onClick={start}
            disabled={busy}
            aria-label="Spustit timer"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm hover:bg-[#0a5d54] disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-4 w-4" aria-hidden>
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          </button>
        )}

        <NotificationsBell wsId={wsId} userId={userId} />
      </div>
    </header>
  );
}
