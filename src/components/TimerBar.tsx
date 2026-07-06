"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entrySeconds, fmtClock } from "@/lib/format";
import {
  startTimer,
  stopRunningTimer,
  updateRunningEntry,
  TIMER_CHANGED_EVENT,
} from "@/lib/timer";
import ProjectPicker from "@/components/ProjectPicker";
import NotificationsBell from "@/components/NotificationsBell";
import type { Project, TimeEntry } from "@/lib/types";

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
  const [, setTick] = useState(0);

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
    const onChange = () => load();
    window.addEventListener(TIMER_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener(TIMER_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
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
    await startTimer(supabase, userId, {
      workspace_id: wsId,
      project_id: idleProject || null,
      description: description.trim(),
    });
    setIdleProject("");
  }

  async function saveDescription() {
    if (!running || description.trim() === running.description) return;
    await updateRunningEntry(supabase, running.id, {
      description: description.trim(),
    });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
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
            <input
              type="text"
              placeholder="Na čem děláš?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={running ? saveDescription : undefined}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (running) e.currentTarget.blur();
                else start();
              }}
              className="input-quiet -ml-2 min-w-40 flex-1 px-2 py-1.5 text-base"
            />
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
            />
          </>
        )}

        <span
          className={`font-mono text-lg font-semibold tabular-nums ${
            running ? "text-brass" : "text-ink-soft/50"
          }`}
        >
          {running ? fmtClock(entrySeconds(running.started_at, null)) : "0:00:00"}
        </span>

        {running ? (
          <button
            onClick={() => stopRunningTimer(supabase, userId)}
            aria-label="Zastavit timer a uložit záznam"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-white shadow-sm hover:bg-red-500"
          >
            <span className="block h-3.5 w-3.5 rounded-[2px] bg-current" />
          </button>
        ) : (
          <button
            onClick={start}
            aria-label="Spustit timer"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-sm hover:bg-[#0a5d54]"
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
