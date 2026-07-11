"use client";

import { priorityColor } from "@/lib/priority";
import { fmtDate } from "@/lib/format";
import { ProjectDot } from "@/components/ProjectPicker";
import type { Task } from "@/lib/types";

/* Sdílená grafická konvence task-list obrazovek (Inbox, Moje úkoly,
   Čekám na, Task force): stejný řádek úkolu a stejný panel skupiny.
   Rozdíly mezi stránkami nesou jen `meta` (chipy/avatary vpravo)
   a `actions` (třídicí ovládání v Inboxu). */

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type DueBucket = {
  key: string;
  label: string;
  tasks: Task[];
  accent?: boolean;
};

/** Rozdělí úkoly podle termínu: po termínu / dnes / tento týden / později /
    bez termínu. Jednotné skupiny pro Moje úkoly i Čekám na. */
export function dueBuckets(tasks: Task[]): DueBucket[] {
  const now = new Date();
  const today = isoDay(now);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const endOfWeek = isoDay(sunday);

  const groups: DueBucket[] = [
    { key: "overdue", label: "Po termínu", tasks: [], accent: true },
    { key: "today", label: "Dnes", tasks: [] },
    { key: "week", label: "Tento týden", tasks: [] },
    { key: "later", label: "Později", tasks: [] },
    { key: "nodate", label: "Bez termínu", tasks: [] },
  ];
  for (const t of tasks) {
    if (!t.due_date) groups[4].tasks.push(t);
    else if (t.due_date < today) groups[0].tasks.push(t);
    else if (t.due_date === today) groups[1].tasks.push(t);
    else if (t.due_date <= endOfWeek) groups[2].tasks.push(t);
    else groups[3].tasks.push(t);
  }
  return groups.filter((g) => g.tasks.length > 0);
}

/** Panel skupiny: hlavička s názvem a počtem, řádky oddělené linkou. */
export function TaskGroup({
  label,
  count,
  accent = false,
  children,
}: {
  label: React.ReactNode;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <h2
        className={`flex items-center gap-1.5 border-b border-line/70 px-3 py-2 text-sm font-semibold ${
          accent ? "text-danger" : ""
        }`}
      >
        {label}
        <span className="text-xs font-normal text-ink-soft/60">{count}</span>
      </h2>
      <div className="divide-y divide-line/50">{children}</div>
    </div>
  );
}

/** Jednotný řádek úkolu: checkbox · název (↻ 🔒) · projekt/sloupec ·
    meta (chipy, avatary) · termín · actions. Klik na řádek otevře kartu. */
export default function TaskRow({
  task,
  onOpen,
  onToggleDone,
  meta,
  actions,
  showProject = true,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  /** chipy/avatary vpravo před termínem (⏳ čekám na, řešitelé…) */
  meta?: React.ReactNode;
  /** ovládání vpravo za termínem (třídění v Inboxu); kliky nepropadají na řádek */
  actions?: React.ReactNode;
  showProject?: boolean;
}) {
  const flag = priorityColor(task.priority ?? 4);
  const done = !!task.completed_at;
  const overdue = !done && task.due_date && task.due_date < isoDay(new Date());

  return (
    <div
      onClick={() => onOpen(task)}
      style={flag ? { boxShadow: `inset 3px 0 0 ${flag}` } : undefined}
      className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-black/[.02]"
    >
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggleDone(task)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Hotovo: ${task.title}`}
        className="h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${done ? "text-ink-soft/70 line-through" : ""}`}>
          {task.title}
          {task.recurrence && (
            <span className="ml-1 text-xs text-ink-soft/50" title="Opakovaný úkol">
              ↻
            </span>
          )}
          {task.is_private && (
            <span
              className="ml-1 text-xs text-ink-soft/50"
              title="Skrytý úkol — vidí ho jen autor a řešitelé"
            >
              🔒
            </span>
          )}
        </p>
        {showProject ? (
          <p className="truncate text-xs text-ink-soft/70">
            <ProjectDot id={task.project_id} className="mr-1 h-2 w-2 align-middle" />
            {task.projects?.name ?? "Bez projektu"}
            {task.board_columns?.name ? ` · ${task.board_columns.name}` : ""}
          </p>
        ) : (
          task.board_columns?.name && (
            <p className="truncate text-xs text-ink-soft/70">
              {task.board_columns.name}
            </p>
          )
        )}
      </div>
      {meta}
      {task.due_date && (
        <span
          className={`whitespace-nowrap text-xs ${
            overdue ? "font-medium text-red-600" : "text-ink-soft"
          }`}
        >
          {fmtDate(task.due_date)}
        </span>
      )}
      {actions && (
        // na mobilu akce padají na vlastní řádek (w-full) — jinak by řádkové
        // pickery smáčkly titul skoro na nulu a úkol nešel ťuknutím otevřít
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:flex-nowrap"
        >
          {actions}
        </div>
      )}
    </div>
  );
}
