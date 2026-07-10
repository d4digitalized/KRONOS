"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { pingNotifyEmails } from "@/lib/notify";
import { notifyTasksChanged, TASKS_CHANGED_EVENT } from "@/lib/tasksChanged";
import ProjectPicker from "@/components/ProjectPicker";
import Picker from "@/components/Picker";
import type { Contact, Membership, Project, Task } from "@/lib/types";

// Modal se načte až při otevření karty — nezatěžuje základní bundle routy.
const CardModal = dynamic(() => import("@/components/CardModal"), { ssr: false });

const USER_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const HOURGLASS_ICON = "M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4";

/** GTD Inbox: rychle nabouchané úkoly bez projektu, řešitele a follow-upu.
    Jakákoli třídící akce (projekt / řešitel / čekám na / hotovo / smazat)
    úkol z Inboxu odsune — seznam se přirozeně vyprazdňuje k nule. */
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

  const load = useCallback(async () => {
    const [tRes, memRes, fuRes, grantRes, cRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*, projects(name, position), task_assignees(user_id)")
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
      canDelegate
        ? supabase.from("contacts").select("*").eq("workspace_id", wsId).order("name")
        : Promise.resolve({ data: [] as Contact[] }),
    ]);
    const waiting = new Set((fuRes.data ?? []).map((r) => r.task_id as string));
    const rows = ((tRes.data ?? []) as unknown as (Task & {
      task_assignees?: { user_id: string }[];
    })[]).filter(
      (t) => (t.task_assignees ?? []).length === 0 && !waiting.has(t.id)
    );
    setTasks(rows);
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

  // ---------------------------------------------------------------- třídění

  async function setProject(task: Task, projectId: string | null) {
    if (!projectId) return;
    const { error } = await supabase
      .from("tasks")
      .update({ project_id: projectId, column_id: null })
      .eq("id", task.id);
    if (error) {
      toast("Přesun do projektu se nezdařil.", "error");
      return;
    }
    toast(
      `„${task.title}" → ${projects.find((p) => p.id === projectId)?.name ?? "projekt"}`
    );
    load();
    notifyTasksChanged();
  }

  async function assign(task: Task, targetId: string | null) {
    if (!targetId) return;
    const { error } = await supabase
      .from("task_assignees")
      .insert({ task_id: task.id, user_id: targetId });
    if (error) {
      toast("Řešitele se nepodařilo přiřadit.", "error");
      return;
    }
    const m = members.find((x) => x.user_id === targetId);
    toast(
      targetId === userId
        ? `„${task.title}" → Moje úkoly`
        : `„${task.title}" → ${m?.profiles?.full_name || m?.profiles?.email}`
    );
    pingNotifyEmails();
    load();
    notifyTasksChanged();
  }

  /** value: "u:<userId>" nebo "c:<contactId>" — jako v kartě. */
  async function setWaiting(task: Task, value: string) {
    if (!value) return;
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
    toast(`„${task.title}" → Delegované`);
    load();
    notifyTasksChanged();
  }

  /** „➕ založit projekt" z pickeru (jen admin — RLS) a rovnou přesunout. */
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

  /** „➕ založit kontakt" z pickeru a rovnou na něj čekat. */
  async function createContactAndWait(task: Task, name: string) {
    const { data, error } = await supabase
      .from("contacts")
      .insert({ workspace_id: wsId, name, created_by: userId })
      .select("id")
      .single();
    if (error || !data) {
      toast("Kontakt se nepodařilo založit.", "error");
      return;
    }
    setContacts((prev) =>
      [...prev, { id: data.id, workspace_id: wsId, name, email: "", note: "", created_by: userId, created_at: "" } as Contact].sort(
        (a, b) => a.name.localeCompare(b.name, "cs")
      )
    );
    await setWaiting(task, `c:${data.id}`);
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
    load();
    notifyTasksChanged();
  }

  async function remove(task: Task) {
    const ok = await confirmDialog({
      title: "Smazat úkol?",
      message: `„${task.title}" se nenávratně smaže.`,
      confirmLabel: "Smazat",
    });
    if (!ok) return;
    await supabase.from("tasks").delete().eq("id", task.id);
    load();
    notifyTasksChanged();
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="font-display text-lg font-semibold">Inbox</h1>
        <p className="text-xs text-ink-soft/70">
          {tasks.length === 0
            ? "Vše zatříděno. 🎉"
            : `${tasks.length} nezatříděných — přiřaď projekt, řešitele, nebo follow-up`}
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
          {tasks.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
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

              {/* třídící akce — každá úkol z Inboxu odsune */}
              <div className="flex items-center gap-1.5">
                <ProjectPicker
                  projects={projects}
                  value={null}
                  onChange={(id) => setProject(task, id)}
                  align="right"
                  hideLabelOnMobile
                  alwaysSearch
                  onCreate={
                    isAdmin ? (name) => createProjectAndMove(task, name) : undefined
                  }
                />
                <Picker
                  options={assignable.map((m) => ({
                    id: m.user_id as string | null,
                    label:
                      m.user_id === userId
                        ? `${m.profiles?.full_name || m.profiles?.email} (já)`
                        : m.profiles?.full_name || m.profiles?.email || "?",
                  }))}
                  value={null}
                  onChange={(id) => assign(task, id)}
                  placeholder="Řešitel"
                  iconPath={USER_ICON}
                  ariaLabel="Řešitel"
                  align="right"
                  hideLabelOnMobile
                  alwaysSearch
                />
                {canDelegate && (
                  <Picker
                    options={[
                      ...members
                        .filter((m) => m.user_id !== userId)
                        .map((m) => ({
                          id: `u:${m.user_id}` as string | null,
                          label: `👤 ${m.profiles?.full_name || m.profiles?.email}`,
                        })),
                      ...contacts.map((c) => ({
                        id: `c:${c.id}` as string | null,
                        label: `👻 ${c.name}`,
                      })),
                    ]}
                    value={null}
                    onChange={(id) => id && setWaiting(task, id)}
                    placeholder="Čekám na"
                    iconPath={HOURGLASS_ICON}
                    ariaLabel="Čekám na"
                    align="right"
                    hideLabelOnMobile
                    alwaysSearch
                    onCreate={(name) => createContactAndWait(task, name)}
                    createLabel="založit kontakt"
                  />
                )}
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
          ))}
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
