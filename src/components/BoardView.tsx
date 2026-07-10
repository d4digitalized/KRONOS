"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { posBetween } from "@/lib/position";
import { startTimer } from "@/lib/timer";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import { PRIORITIES } from "@/lib/priority";
import type { BoardColumn, Label, Membership, Task } from "@/lib/types";
import BoardCard from "@/components/BoardCard";
import { ProjectDot } from "@/components/ProjectPicker";

// Modal karty mimo základní bundle nástěnky — načte se až při otevření.
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

type CardsByCol = Record<string, Task[]>;

const COL_PREFIX = "col:";

function colDndId(id: string) {
  return `${COL_PREFIX}${id}`;
}

function isColId(id: string) {
  return id.startsWith(COL_PREFIX);
}

function stripCol(id: string) {
  return id.slice(COL_PREFIX.length);
}

export default function BoardView({
  wsId,
  projectId,
  projectName,
  userId,
}: {
  wsId: string;
  projectId: string;
  projectName: string;
  userId: string;
}) {
  const supabase = createClient();
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [cards, setCards] = useState<CardsByCol>({});
  const [orphans, setOrphans] = useState<Task[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [activeCard, setActiveCard] = useState<Task | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [editColName, setEditColName] = useState("");
  const [cardLabels, setCardLabels] = useState<Record<string, Label[]>>({});
  const [cardAssignees, setCardAssignees] = useState<Record<string, string[]>>({});
  const [cardWaiting, setCardWaiting] = useState<Record<string, string>>({});
  const [subCounts, setSubCounts] = useState<Record<string, { done: number; total: number }>>({});
  const [wsLabels, setWsLabels] = useState<Label[]>([]);
  // filtry
  const [fText, setFText] = useState("");
  const [fPriority, setFPriority] = useState(0);
  const [fLabel, setFLabel] = useState("");
  const [fAssignee, setFAssignee] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // dotyk: krátké podržení odliší tažení karty od scrollování
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    const [colRes, taskRes, memRes, subRes, labelRes, tlRes, taRes, fuRes] = await Promise.all([
      supabase
        .from("board_columns")
        .select("*")
        .eq("project_id", projectId)
        .order("position"),
      supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .is("parent_id", null) // podúkoly žijí jen v modalu karty
        .order("position"),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      supabase
        .from("tasks")
        .select("parent_id, completed_at")
        .eq("project_id", projectId)
        .not("parent_id", "is", null),
      supabase.from("labels").select("*").eq("workspace_id", wsId).order("name"),
      supabase
        .from("task_labels")
        .select("task_id, labels!inner(id, workspace_id, name)")
        .eq("labels.workspace_id", wsId),
      supabase
        .from("task_assignees")
        .select("task_id, user_id, tasks!inner(project_id)")
        .eq("tasks.project_id", projectId),
      supabase
        .from("task_followups")
        .select("task_id, waiting_user_id, contacts(name), tasks!inner(project_id)")
        .eq("tasks.project_id", projectId),
    ]);
    const cols = (colRes.data as BoardColumn[]) ?? [];
    const tasks = (taskRes.data as Task[]) ?? [];

    const counts: Record<string, { done: number; total: number }> = {};
    for (const sub of subRes.data ?? []) {
      const key = sub.parent_id as string;
      counts[key] = counts[key] ?? { done: 0, total: 0 };
      counts[key].total += 1;
      if (sub.completed_at) counts[key].done += 1;
    }
    setSubCounts(counts);

    setWsLabels((labelRes.data as Label[]) ?? []);
    const byTask: Record<string, Label[]> = {};
    for (const row of tlRes.data ?? []) {
      const label = row.labels as unknown as Label;
      if (!label) continue;
      byTask[row.task_id] = [...(byTask[row.task_id] ?? []), label];
    }
    setCardLabels(byTask);

    const assigneesByTask: Record<string, string[]> = {};
    for (const row of taRes.data ?? []) {
      assigneesByTask[row.task_id] = [
        ...(assigneesByTask[row.task_id] ?? []),
        row.user_id as string,
      ];
    }
    setCardAssignees(assigneesByTask);

    // štítek „čeká na X" — jméno člena z memRes, kontaktu z embedded contacts
    const mems = (memRes.data as unknown as Membership[]) ?? [];
    const waitingByTask: Record<string, string> = {};
    for (const row of fuRes.data ?? []) {
      const contact = row.contacts as unknown as { name: string } | null;
      const member = row.waiting_user_id
        ? mems.find((m) => m.user_id === row.waiting_user_id)
        : null;
      const name = row.waiting_user_id
        ? member?.profiles?.full_name || member?.profiles?.email
        : contact?.name;
      if (name) waitingByTask[row.task_id as string] = name;
    }
    setCardWaiting(waitingByTask);

    const byCol: CardsByCol = {};
    const lost: Task[] = [];
    for (const col of cols) byCol[col.id] = [];
    for (const task of tasks) {
      if (task.column_id && byCol[task.column_id]) byCol[task.column_id].push(task);
      else if (cols[0]) byCol[cols[0].id].push(task); // karta bez sloupce → první sloupec
      else lost.push(task); // žádné sloupce neexistují — karty nesmí zmizet
    }
    setColumns(cols);
    setCards(byCol);
    setOrphans(lost);
    setMembers(mems);
    setLoading(false);
  }, [supabase, projectId, wsId]);

  useEffect(() => {
    load();
    // nový úkol z plovoucího „+" v layoutu — přenačti nástěnku
    const onChanged = () => load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

  // stabilní handlery pro karty — bez nich by memo(BoardCard) nefungovalo
  const openCard = useCallback((task: Task) => setOpenTask(task), []);
  const startCard = useCallback(
    (task: Task) =>
      startTimer(supabase, userId, {
        workspace_id: wsId,
        project_id: projectId,
        task_id: task.id,
        task_title: task.title,
      }),
    [supabase, userId, wsId, projectId]
  );

  // ---------------------------------------------------------------- sloupce

  async function addColumn(e: React.FormEvent) {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    const last = columns[columns.length - 1];
    const { error } = await supabase.from("board_columns").insert({
      workspace_id: wsId,
      project_id: projectId,
      name: newColumnName.trim(),
      position: posBetween(last?.position, undefined),
    });
    if (error) {
      toast("Sloupec se nepodařilo přidat.", "error");
      return;
    }
    setNewColumnName("");
    load();
  }

  function startRenameColumn(col: BoardColumn) {
    setEditingCol(col.id);
    setEditColName(col.name);
  }

  async function saveRenameColumn(col: BoardColumn) {
    const name = editColName.trim();
    setEditingCol(null);
    if (!name || name === col.name) return;
    const { error } = await supabase
      .from("board_columns")
      .update({ name })
      .eq("id", col.id);
    if (error) toast("Přejmenování se nepodařilo.", "error");
    load();
  }

  async function deleteColumn(col: BoardColumn) {
    if ((cards[col.id] ?? []).length > 0) {
      toast("Sloupec není prázdný — nejdřív přesuň karty jinam.", "error");
      return;
    }
    const ok = await confirmDialog({
      title: "Smazat sloupec?",
      message: `Sloupec „${col.name}" se smaže.`,
    });
    if (!ok) return;
    const { error } = await supabase.from("board_columns").delete().eq("id", col.id);
    if (error) toast("Smazání se nepodařilo.", "error");
    load();
  }

  // ---------------------------------------------------------------- karty

  async function addCard(colId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!newCardTitle.trim()) return;
    const list = cards[colId] ?? [];
    const { error } = await supabase.from("tasks").insert({
      workspace_id: wsId,
      project_id: projectId,
      column_id: colId,
      title: newCardTitle.trim(),
      position: posBetween(list[list.length - 1]?.position, undefined),
    });
    if (error) {
      toast("Kartu se nepodařilo přidat.", "error");
      return;
    }
    setNewCardTitle("");
    load();
  }

  function findColumnOf(cardId: string): string | undefined {
    return Object.keys(cards).find((colId) =>
      cards[colId].some((t) => t.id === cardId)
    );
  }

  // ---------------------------------------------------------------- drag & drop

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (!isColId(id)) {
      const colId = findColumnOf(id);
      setActiveCard(cards[colId ?? ""]?.find((t) => t.id === id) ?? null);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (isColId(activeId)) return; // přesun sloupců řeší až dragEnd

    const fromCol = findColumnOf(activeId);
    const toCol = isColId(overId) ? stripCol(overId) : findColumnOf(overId);
    if (!fromCol || !toCol || fromCol === toCol) return;

    // optimistický přesun mezi sloupci, ať je vidět "díra"
    setCards((prev) => {
      const moving = prev[fromCol].find((t) => t.id === activeId);
      if (!moving) return prev;
      const fromList = prev[fromCol].filter((t) => t.id !== activeId);
      const toList = [...prev[toCol]];
      const overIndex = toList.findIndex((t) => t.id === overId);
      toList.splice(overIndex >= 0 ? overIndex : toList.length, 0, {
        ...moving,
        column_id: toCol,
      });
      return { ...prev, [fromCol]: fromList, [toCol]: toList };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // přeřazení sloupců
    if (isColId(activeId)) {
      if (activeId === overId || !isColId(overId)) return;
      const oldIndex = columns.findIndex((c) => colDndId(c.id) === activeId);
      const newIndex = columns.findIndex((c) => colDndId(c.id) === overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(columns, oldIndex, newIndex);
      const moved = reordered[newIndex];
      const position = posBetween(
        reordered[newIndex - 1]?.position,
        reordered[newIndex + 1]?.position
      );
      setColumns(reordered.map((c) => (c.id === moved.id ? { ...c, position } : c)));
      const { error } = await supabase
        .from("board_columns")
        .update({ position })
        .eq("id", moved.id);
      if (error) {
        toast("Přesun sloupce se neuložil — obnovuji nástěnku.", "error");
        load();
      }
      return;
    }

    // dokončení přesunu karty
    const colId = findColumnOf(activeId);
    if (!colId) return;
    let list = cards[colId];
    const oldIndex = list.findIndex((t) => t.id === activeId);
    const overIndex = list.findIndex((t) => t.id === overId);
    if (overIndex >= 0 && oldIndex !== overIndex) {
      list = arrayMove(list, oldIndex, overIndex);
    }
    const newIndex = list.findIndex((t) => t.id === activeId);
    const position = posBetween(
      list[newIndex - 1]?.position,
      list[newIndex + 1]?.position
    );
    const updated = list.map((t) =>
      t.id === activeId ? { ...t, position, column_id: colId } : t
    );
    setCards((prev) => ({ ...prev, [colId]: updated }));
    const { error } = await supabase
      .from("tasks")
      .update({ column_id: colId, position })
      .eq("id", activeId);
    if (error) {
      toast("Přesun karty se neuložil — obnovuji nástěnku.", "error");
      load();
    }
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  const filterActive =
    fText.trim() !== "" || fPriority !== 0 || fLabel !== "" || fAssignee !== "";
  const visible = (list: Task[]): Task[] => {
    if (!filterActive) return list;
    const q = fText.trim().toLowerCase();
    return list.filter(
      (t) =>
        (!q ||
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)) &&
        (fPriority === 0 || (t.priority ?? 4) === fPriority) &&
        (!fLabel || (cardLabels[t.id] ?? []).some((l) => l.id === fLabel)) &&
        (!fAssignee || (cardAssignees[t.id] ?? []).includes(fAssignee))
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2.5 font-display text-lg font-semibold">
          <ProjectDot id={projectId} className="h-3 w-3" />
          {projectName}
        </h1>
        <span className="flex-1" />
        <input
          type="search"
          placeholder="Hledat na nástěnce…"
          value={fText}
          onChange={(e) => setFText(e.target.value)}
          className="input w-44 px-2 py-1 text-sm"
        />
        <select
          value={fPriority}
          onChange={(e) => setFPriority(Number(e.target.value))}
          aria-label="Filtr priority"
          className="input px-2 py-1 text-sm"
        >
          <option value={0}>Priorita: vše</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {wsLabels.length > 0 && (
          <select
            value={fLabel}
            onChange={(e) => setFLabel(e.target.value)}
            aria-label="Filtr štítku"
            className="input px-2 py-1 text-sm"
          >
            <option value="">Štítek: vše</option>
            {wsLabels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={fAssignee}
          onChange={(e) => setFAssignee(e.target.value)}
          aria-label="Filtr řešitele"
          className="input px-2 py-1 text-sm"
        >
          <option value="">Řešitel: všichni</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profiles?.full_name || m.profiles?.email}
            </option>
          ))}
        </select>
        {filterActive && (
          <button
            onClick={() => {
              setFText("");
              setFPriority(0);
              setFLabel("");
              setFAssignee("");
            }}
            className="btn-ghost px-2 py-1 text-xs"
          >
            Zrušit filtry
          </button>
        )}
      </div>

      {orphans.length > 0 && (
        <div className="panel space-y-2 border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Tyto karty nemají sloupec. Založ sloupec a karty do něj přesuň
            přetažením, nebo je otevři a uprav.
          </p>
          <div className="flex flex-wrap gap-2">
            {orphans.map((task) => (
              <button
                key={task.id}
                onClick={() => setOpenTask(task)}
                className="rounded-lg border border-amber-300 bg-surface px-2 py-1 text-sm hover:border-accent/60"
              >
                {task.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex items-start gap-3 overflow-x-auto scroll-touch snap-x snap-proximity pb-4">
          <SortableContext
            items={columns.map((c) => colDndId(c.id))}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((col) => (
              <SortableColumn
                key={col.id}
                column={col}
                cardCount={visible(cards[col.id] ?? []).length}
                isEditing={editingCol === col.id}
                editName={editColName}
                onEditName={setEditColName}
                onStartRename={() => startRenameColumn(col)}
                onSaveRename={() => saveRenameColumn(col)}
                onDelete={() => deleteColumn(col)}
              >
                <SortableContext
                  items={visible(cards[col.id] ?? []).map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex min-h-2 flex-col gap-2">
                    {visible(cards[col.id] ?? []).map((task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        members={members}
                        labels={cardLabels[task.id]}
                        assigneeIds={cardAssignees[task.id]}
                        subtaskCount={subCounts[task.id]}
                        waitingOn={cardWaiting[task.id]}
                        onOpen={openCard}
                        onStart={startCard}
                      />
                    ))}
                  </div>
                </SortableContext>

                {addingTo === col.id ? (
                  <form onSubmit={(e) => addCard(col.id, e)} className="mt-2 flex gap-1">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Název karty…"
                      value={newCardTitle}
                      onChange={(e) => setNewCardTitle(e.target.value)}
                      onBlur={() => !newCardTitle.trim() && setAddingTo(null)}
                      className="w-full input px-2"
                    />
                    <button type="submit" className="btn-primary px-2">
                      OK
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => {
                      setAddingTo(col.id);
                      setNewCardTitle("");
                    }}
                    className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs text-ink-soft/70 hover:bg-black/10 hover:text-ink-soft"
                  >
                    + Přidat kartu
                  </button>
                )}
              </SortableColumn>
            ))}
          </SortableContext>

          <form onSubmit={addColumn} className="w-64 shrink-0">
            <input
              type="text"
              placeholder={
                columns.length === 0
                  ? "Začni prvním sloupcem, např. „K udělání“…"
                  : "+ Nový sloupec…"
              }
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              className="w-full rounded-lg border border-dashed border-line bg-transparent px-3 py-2 text-sm placeholder:text-ink-soft/70"
            />
          </form>
        </div>

        <DragOverlay>
          {activeCard && (
            <div className="rounded-lg border border-line bg-surface p-2 shadow-lg">
              <p className="text-sm">{activeCard.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

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

function SortableColumn({
  column,
  cardCount,
  isEditing,
  editName,
  onEditName,
  onStartRename,
  onSaveRename,
  onDelete,
  children,
}: {
  column: BoardColumn;
  cardCount: number;
  isEditing: boolean;
  editName: string;
  onEditName: (v: string) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: colDndId(column.id), data: { type: "column" } });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`w-64 shrink-0 snap-start rounded-xl bg-black/5 p-2 ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="mb-2 flex items-center gap-1">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Přetáhnout sloupec ${column.name}`}
          className="cursor-grab rounded px-1 text-ink-soft/70 hover:bg-black/10"
        >
          ⠿
        </button>
        {isEditing ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              onSaveRename();
            }}
          >
            <input
              autoFocus
              type="text"
              value={editName}
              onChange={(e) => onEditName(e.target.value)}
              onBlur={onSaveRename}
              className="w-full input px-1 py-0.5 text-sm"
            />
          </form>
        ) : (
          <button
            onClick={onStartRename}
            className="flex-1 truncate rounded px-1 text-left text-sm font-semibold hover:bg-black/5"
            title="Kliknutím přejmenuješ"
          >
            {column.name}
            <span className="ml-1.5 text-xs font-normal text-ink-soft/70">
              {cardCount}
            </span>
          </button>
        )}
        <button
          onClick={onDelete}
          aria-label={`Smazat sloupec ${column.name}`}
          className="rounded px-1 text-xs text-ink-soft/70 hover:bg-black/10"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}
