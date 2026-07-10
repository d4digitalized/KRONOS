"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { pingNotifyEmails } from "@/lib/notify";
import { notifyTasksChanged, TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import ProjectPicker from "@/components/ProjectPicker";
import PersonPicker, { HOURGLASS_ICON } from "@/components/PersonPicker";
import type { Contact, Membership, Project, Task } from "@/lib/types";

// Modal se načte až při otevření karty — nezatěžuje základní bundle routy.
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

/** Rozpracované třídění řádku: co už uživatel vybral (zapsáno v DB). */
type SortState = {
  project: string | null;
  /** "u:<userId>" (člen) | "c:<contactId>" (duch) */
  assignee: string | null;
  /** "u:<userId>" | "c:<contactId>" */
  waiting: string | null;
};

const EMPTY_SORT: SortState = { project: null, assignee: null, waiting: null };

/** GTD Inbox: rychle nabouchané úkoly bez projektu, řešitele a follow-upu.
    Třídící volby se ukládají hned, ale řádek zůstává (jde měnit názor),
    dokud uživatel nepotvrdí „Utříděno" — teprve pak z Inboxu zmizí.
    Po novém načtení stránky se zatříděné úkoly už nenačtou. */
export default function InboxView({
  wsId,
  userId,
  canDelegate,
}: {
  wsId: string;
  userId: string;
  canDelegate: boolean;
}) {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // rozpracované třídění — ref kvůli merge v load() bez závodu se setState
  const sortRef = useRef<Record<string, SortState>>({});
  const [, bump] = useState(0);

  function patchSort(taskId: string, patch: Partial<SortState> | null) {
    if (patch === null) delete sortRef.current[taskId];
    else
      sortRef.current[taskId] = {
        ...(sortRef.current[taskId] ?? EMPTY_SORT),
        ...patch,
      };
    bump((x) => x + 1);
  }

  const load = useCallback(async () => {
    const [tRes, memRes, fuRes, grantRes, cRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "*, projects(name, position), task_assignees(user_id), task_contact_assignees(contact_id)"
        )
        .eq("workspace_id", wsId)
        .eq("created_by", userId)
        .is("project_id", null)
        .is("completed_at", null)
        .is("parent_id", null)
        .order("created_at"),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      supabase
        .from("task_followups")
        .select("task_id")
        .eq("workspace_id", wsId)
        .eq("created_by", userId),
      supabase
        .from("assign_grants")
        .select("target_id")
        .eq("workspace_id", wsId)
        .eq("user_id", userId),
      supabase.from("contacts").select("*").eq("workspace_id", wsId).order("name"),
    ]);
    const waiting = new Set((fuRes.data ?? []).map((r) => r.task_id as string));
    const fresh = ((tRes.data ?? []) as unknown as (Task & {
      task_assignees?: { user_id: string }[];
      task_contact_assignees?: { contact_id: string }[];
    })[]).filter(
      (t) =>
        (t.task_assignees ?? []).length === 0 &&
        (t.task_contact_assignees ?? []).length === 0 &&
        !waiting.has(t.id)
    );
    // rozpracované (už zatříděné v DB, ale nepotvrzené) řádky nechat viset
    setTasks((prev) => {
      const freshIds = new Set(fresh.map((t) => t.id));
      const inProgress = prev.filter(
        (t) => !freshIds.has(t.id) && sortRef.current[t.id]
      );
      return [...fresh, ...inProgress];
    });
    setMembers((memRes.data as unknown as Membership[]) ?? []);
    setGrants(new Set((grantRes.data ?? []).map((r) => r.target_id as string)));
    setContacts((cRes.data as Contact[]) ?? []);
    setLoading(false);
  }, [supabase, wsId, userId, canDelegate]);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(TASKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChanged);
  }, [load]);

  // projekty pro řádkový picker
  const [projects, setProjects] = useState<Project[]>([]);
  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", wsId)
      .eq("archived", false)
      .order("position")
      .order("name");
    setProjects((data as Project[]) ?? []);
  }, [supabase, wsId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const me = members.find((m) => m.user_id === userId);
  const isAdmin = !!(me?.profiles?.is_super_admin || me?.role === "admin");
  // komu smím zadávat: admin komukoli, člen sobě + s grantem
  const assignable = members.filter(
    (m) => isAdmin || m.user_id === userId || grants.has(m.user_id)
  );

  // ---------------------------------------------------------------- capture

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const { error } = await supabase
      .from("tasks")
      .insert({ workspace_id: wsId, title, position: 0 });
    if (error) {
      toast("Úkol se nepodařilo přidat.", "error");
      return;
    }
    setNewTitle("");
    inputRef.current?.focus(); // hned další myšlenka
    load();
    notifyTasksChanged();
  }

  // ------------------------------------------------------- třídění (průběžné)
  // Každá volba se hned zapíše do DB, ale řádek visí dál — jde měnit názor.
  // Z Inboxu ho odsune až „Utříděno" (nebo hotovo/smazat/reload stránky).

  async function setProject(task: Task, projectId: string | null) {
    const { error } = await supabase
      .from("tasks")
      .update({ project_id: projectId, column_id: null })
      .eq("id", task.id);
    if (error) {
      toast("Přesun do projektu se nezdařil.", "error");
      return;
    }
    patchSort(task.id, { project: projectId });
  }

  /** value: "u:<userId>" (člen) nebo "c:<contactId>" (duch); null = zrušit. */
  async function assign(task: Task, value: string | null) {
    const prev = sortRef.current[task.id]?.assignee ?? null;
    if (prev === value) return;
    if (prev) {
      const prevId = prev.slice(2);
      if (prev.startsWith("u:"))
        await supabase
          .from("task_assignees")
          .delete()
          .eq("task_id", task.id)
          .eq("user_id", prevId);
      else
        await supabase
          .from("task_contact_assignees")
          .delete()
          .eq("task_id", task.id)
          .eq("contact_id", prevId);
    }
    if (value) {
      const id = value.slice(2);
      const { error } = value.startsWith("u:")
        ? await supabase
            .from("task_assignees")
            .insert({ task_id: task.id, user_id: id })
        : await supabase
            .from("task_contact_assignees")
            .insert({ task_id: task.id, contact_id: id });
      if (error) {
        toast("Řešitele se nepodařilo přiřadit.", "error");
        return;
      }
      if (value.startsWith("u:")) pingNotifyEmails();
    }
    patchSort(task.id, { assignee: value });
  }

  /** Nový duch z „➕ založit" v PersonPickeru — jen doplnit do seznamu. */
  function addContact(contact: Contact) {
    setContacts((prev) =>
      [...prev, contact].sort((a, b) => a.name.localeCompare(b.name, "cs"))
    );
  }

  /** value: "u:<userId>" nebo "c:<contactId>" — jako v kartě; null = zrušit. */
  async function setWaiting(task: Task, value: string | null) {
    const prev = sortRef.current[task.id]?.waiting ?? null;
    if (prev === value) return;
    if (prev) {
      await supabase.from("task_followups").delete().eq("task_id", task.id);
    }
    if (value) {
      const id = value.slice(2);
      const { error } = await supabase.from("task_followups").insert({
        task_id: task.id,
        workspace_id: wsId,
        created_by: userId,
        waiting_user_id: value.startsWith("u:") ? id : null,
        waiting_contact_id: value.startsWith("c:") ? id : null,
      });
      if (error) {
        toast("Čekání se nepodařilo nastavit.", "error");
        return;
      }
    }
    patchSort(task.id, { waiting: value });
  }

  /** „➕ založit projekt" z pickeru (jen admin — RLS) a rovnou přiřadit. */
  async function createProjectAndMove(task: Task, name: string) {
    const { data, error } = await supabase
      .from("projects")
      .insert({ workspace_id: wsId, name })
      .select("id")
      .single();
    if (error || !data) {
      toast("Projekt se nepodařilo založit.", "error");
      return;
    }
    await loadProjects();
    await setProject(task, data.id as string);
  }

  // ---------------------------------------------------------------- odsunutí

  function dismiss(task: Task) {
    patchSort(task.id, null);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    notifyTasksChanged(); // počítadlo v navigaci
  }

  function markSorted(task: Task) {
    const s = sortRef.current[task.id];
    const assigneeText = !s?.assignee
      ? null
      : s.assignee === `u:${userId}`
        ? "Moje úkoly"
        : s.assignee.startsWith("u:")
          ? members.find((m) => m.user_id === s.assignee!.slice(2))?.profiles
              ?.full_name
          : `👻 ${contacts.find((c) => c.id === s.assignee!.slice(2))?.name ?? "duch"}`;
    const where = [
      s?.project ? (projects.find((p) => p.id === s.project)?.name ?? "projekt") : null,
      assigneeText,
      s?.waiting ? "Čekám na" : null,
    ].filter(Boolean);
    toast(`Utříděno: ${task.title}${where.length ? ` → ${where.join(", ")}` : ""}`);
    dismiss(task);
  }

  async function done(task: Task) {
    const { error } = await supabase
      .from("tasks")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) {
      toast("Uložení se nezdařilo.", "error");
      return;
    }
    toast(`Hotovo: ${task.title}`);
    dismiss(task);
  }

  async function remove(task: Task) {
    const ok = await confirmDialog({
      title: "Smazat úkol?",
      message: `„${task.title}" se nenávratně smaže.`,
      confirmLabel: "Smazat",
    });
    if (!ok) return;
    await supabase.from("tasks").delete().eq("id", task.id);
    dismiss(task);
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="font-display text-lg font-semibold">Inbox</h1>
        <p className="text-xs text-ink-soft/70">
          {tasks.length === 0
            ? "Vše zatříděno. 🎉"
            : `${tasks.length} nezatříděných — vyber projekt, řešitele či follow-up a potvrď Utříděno`}
        </p>
      </div>

      {/* rychlé nabouchání: napiš, Enter, piš další */}
      <form onSubmit={addTask} className="panel flex items-center gap-2 p-2">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          placeholder="Nabouchej myšlenku a stiskni Enter…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="input-quiet flex-1 px-2 py-1.5 text-sm"
        />
        {newTitle.trim() && (
          <button type="submit" className="btn-primary px-3 py-1 text-sm">
            Přidat
          </button>
        )}
      </form>

      {tasks.length > 0 && (
        <div className="panel divide-y divide-line/50">
          {tasks.map((task) => {
            const s = sortRef.current[task.id] ?? EMPTY_SORT;
            const touched = !!(s.project || s.assignee || s.waiting);
            return (
              <div
                key={task.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => done(task)}
                  aria-label={`Hotovo: ${task.title}`}
                  className="h-4 w-4"
                />
                <button
                  onClick={() => setOpenTask(task)}
                  className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent"
                  title="Otevřít detail"
                >
                  {task.title}
                </button>

                {/* třídící volby — ukládají se hned, řádek visí do potvrzení */}
                <div className="flex items-center gap-1.5">
                  <ProjectPicker
                    projects={projects}
                    value={s.project}
                    onChange={(id) => setProject(task, id)}
                    align="right"
                    hideLabelOnMobile
                    alwaysSearch
                    onCreate={
                      isAdmin ? (name) => createProjectAndMove(task, name) : undefined
                    }
                  />
                  <PersonPicker
                    wsId={wsId}
                    userId={userId}
                    members={assignable}
                    contacts={contacts}
                    value={s.assignee}
                    onChange={(ref) => assign(task, ref)}
                    onContactCreated={addContact}
                    noneLabel="Bez řešitele"
                    placeholder="Řešitel"
                    ariaLabel="Řešitel"
                    align="right"
                    hideLabelOnMobile
                  />
                  {canDelegate && (
                    <PersonPicker
                      wsId={wsId}
                      userId={userId}
                      members={members}
                      contacts={contacts}
                      value={s.waiting}
                      onChange={(ref) => setWaiting(task, ref)}
                      onContactCreated={addContact}
                      includeMe={false}
                      noneLabel="— nikdo —"
                      placeholder="Čekám na"
                      ariaLabel="Čekám na"
                      iconPath={HOURGLASS_ICON}
                      align="right"
                      hideLabelOnMobile
                    />
                  )}
                  <button
                    onClick={() => markSorted(task)}
                    disabled={!touched}
                    title={
                      touched
                        ? "Hotovo s tříděním — odsunout z Inboxu"
                        : "Nejdřív vyber projekt, řešitele nebo follow-up"
                    }
                    className="rounded-md border border-accent/50 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Utříděno ✓
                  </button>
                  <button
                    onClick={() => remove(task)}
                    aria-label={`Smazat ${task.title}`}
                    title="Smazat"
                    className="rounded px-1.5 py-1 text-sm text-ink-soft/50 hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
            notifyTasksChanged();
          }}
        />
      )}
    </div>
  );
}
