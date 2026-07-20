"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { posBetween } from "@/lib/position";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { cacheGet, cacheSet } from "@/lib/viewCache";
import { TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import { fmtDate } from "@/lib/format";
import { priorityColor } from "@/lib/priority";
import { ProjectDot } from "@/components/ProjectPicker";
import type { Membership, Task } from "@/lib/types";

// Modal se načte až při otevření karty — nezatěžuje základní bundle routy.
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

/** Úkol s názvem firmy — Priority list míchá úkoly ze všech mých firem. */
type PriorityTask = Task & { workspaces?: { name: string } | null };

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Osobní seznam „na čem dělám teď": moje otevřené úkoly ze všech firem
    v pořadí, které si sám určím přetahováním. Pořadí je jen moje
    (task_priority) a nemá vliv na nic jiného v aplikaci. */
export default function PriorityListView({
  wsId,
  userId,
}: {
  /** firma, ze které jsem sem přišel — jen pro CardModal a odkazy */
  wsId: string;
  userId: string;
}) {
  const supabase = createClient();
  const cacheKey = `priority:${userId}`;
  const cached = cacheGet<{ tasks: PriorityTask[]; members: Membership[] }>(cacheKey);
  const [tasks, setTasks] = useState<PriorityTask[]>(cached?.tasks ?? []);
  const [members, setMembers] = useState<Membership[]>(cached?.members ?? []);
  const [loading, setLoading] = useState(!cached);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<PriorityTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // dotyk: krátké podržení odliší tažení řádku od scrollování
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    const [mineRes, memRes, fuRes, orderRes] = await Promise.all([
      supabase
        .from("task_assignees")
        .select(
          "tasks!inner(*, projects(name, position), board_columns(name), workspaces(name))"
        )
        .eq("user_id", userId)
        .is("tasks.completed_at", null)
        .is("tasks.parent_id", null),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      supabase.from("task_followups").select("task_id").eq("created_by", userId),
      supabase
        .from("task_priority")
        .select("task_id, position")
        .eq("user_id", userId),
    ]);
    const waiting = new Set((fuRes.data ?? []).map((r) => r.task_id as string));
    const order = new Map(
      (orderRes.data ?? []).map((r) => [r.task_id as string, r.position as number])
    );
    const mine = ((mineRes.data ?? []) as unknown as { tasks: PriorityTask }[])
      .map((r) => r.tasks)
      // stejná pravidla jako Moje úkoly: bez follow-upů a bez uspaných karet
      .filter((t) => !waiting.has(t.id) && !t.on_hold)
      // seřazené položky napřed (podle mého pořadí), zbytek podle termínu
      .sort((a, b) => {
        const pa = order.get(a.id);
        const pb = order.get(b.id);
        if (pa !== undefined && pb !== undefined) return pa - pb;
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return (
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
          (a.priority ?? 4) - (b.priority ?? 4) ||
          a.title.localeCompare(b.title, "cs")
        );
      });
    const mem = (memRes.data as unknown as Membership[]) ?? [];
    setTasks(mine);
    setMembers(mem);
    cacheSet(cacheKey, { tasks: mine, members: mem });
    setLoading(false);
  }, [supabase, userId, wsId, cacheKey]);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

  async function toggleDone(task: Task) {
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) {
      toast("Uložení se nezdařilo.", "error");
      return;
    }
    toast(`Hotovo: ${task.title}`);
    pingNotifyEmails(); // opakovaná karta může přiřadit další výskyt
    load();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === String(event.active.id)) ?? null);
  }

  /** Uloží jen přetažený řádek — pozici mezi sousedy. Sousedé, kteří ještě
      nemají vlastní pořadí, ho dostanou taky, aby seznam držel tvar. */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => t.id === String(active.id));
    const newIndex = tasks.findIndex((t) => t.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(tasks, oldIndex, newIndex);
    setTasks(reordered); // optimisticky, ať přetažení nepoblikává
    // přepočet celého seznamu je nejjednodušší a spolehlivý (desítky řádků)
    const rows = reordered.map((t, i) => ({
      user_id: userId,
      task_id: t.id,
      position: (i + 1) * 1000,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("task_priority")
      .upsert(rows, { onConflict: "user_id,task_id" });
    if (error) {
      toast("Pořadí se neuložilo — obnovuji seznam.", "error");
      load();
    }
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const today = isoDay(new Date());

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="font-display text-lg font-semibold">Priority list</h1>
        <p className="text-xs text-ink-soft/70">
          {tasks.length === 0
            ? "Žádné otevřené úkoly."
            : `${tasks.length} úkolů ze všech firem — pořadí si určuješ přetažením`}
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="panel p-8 text-center text-sm text-ink-soft/70">
          Nemáš žádné otevřené úkoly. 🎉
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="panel divide-y divide-line/50">
              {tasks.map((task, index) => (
                <PriorityRow
                  key={task.id}
                  task={task}
                  order={index + 1}
                  today={today}
                  onOpen={setOpenTask}
                  onToggleDone={toggleDone}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeTask && (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-lg">
                <p className="text-sm">{activeTask.title}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
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

/** Řádek Priority listu: úchyt · pořadí · název · firma/projekt · termín.
    Vlastní řádek (ne sdílený TaskRow) kvůli drag úchytu a číslu pořadí. */
function PriorityRow({
  task,
  order,
  today,
  onOpen,
  onToggleDone,
}: {
  task: PriorityTask;
  order: number;
  today: string;
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  const flag = priorityColor(task.priority ?? 4);
  const overdue = task.due_date && task.due_date < today;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(flag ? { boxShadow: `inset 3px 0 0 ${flag}` } : {}),
      }}
      onClick={() => onOpen(task)}
      className={`flex cursor-pointer items-center gap-2 px-2 py-2 hover:bg-black/[.02] sm:gap-3 sm:px-3 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Přetáhnout ${task.title}`}
        title="Přetažením změníš pořadí"
        className="cursor-grab rounded px-1 text-ink-soft/50 hover:bg-black/5 hover:text-ink-soft"
      >
        ⠿
      </button>
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-soft/50">
        {order}
      </span>
      <input
        type="checkbox"
        checked={false}
        onChange={() => onToggleDone(task)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Hotovo: ${task.title}`}
        className="hidden h-4 w-4 sm:block"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {task.title}
          {task.recurrence && (
            <span className="ml-1 text-xs text-ink-soft/50" title="Opakovaný úkol">
              ↻
            </span>
          )}
          {task.is_private && (
            <span
              className="ml-1 text-xs text-ink-soft/50"
              title="Skrytý úkol — vidí ho jen jeho autor"
            >
              🔒
            </span>
          )}
        </p>
        <p className="truncate text-xs text-ink-soft/70">
          {task.workspaces?.name && (
            <span className="font-medium">{task.workspaces.name}</span>
          )}
          {task.workspaces?.name && " · "}
          <ProjectDot id={task.project_id} className="mr-1 h-2 w-2 align-middle" />
          {task.projects?.name ?? "Bez projektu"}
        </p>
      </div>
      {task.due_date && (
        <span
          className={`whitespace-nowrap text-xs ${
            overdue ? "font-medium text-red-600" : "text-ink-soft"
          }`}
        >
          {fmtDate(task.due_date)}
        </span>
      )}
    </div>
  );
}
