"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startTimer } from "@/lib/timer";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { pingNotifyEmails } from "@/lib/notify";
import { notifyTasksChanged } from "@/lib/tasksChanged";
import { PRIORITIES, RECURRENCE_OPTIONS, priorityColor } from "@/lib/priority";
import ProjectPicker, { projectColor } from "@/components/ProjectPicker";
import PersonPicker, {
  HOURGLASS_ICON,
  isMemberRef,
  personRefId,
} from "@/components/PersonPicker";
import Avatar from "@/components/Avatar";
import CardAttachments from "@/components/CardAttachments";
import CardChecklists from "@/components/CardChecklists";
import type {
  Contact,
  Label,
  Membership,
  Project,
  Recurrence,
  Task,
  TaskActivity,
  TaskComment,
  TaskFollowup,
} from "@/lib/types";

/** Věta aktivity v češtině podle typu události. */
function activityText(a: TaskActivity): string {
  const m = a.meta ?? {};
  const to = m.to as string | number | null | undefined;
  const from = m.from as string | number | null | undefined;
  switch (a.kind) {
    case "created":
      return "vytvořil/a kartu";
    case "moved_column":
      return `přesunul/a kartu do sloupce „${to ?? "?"}"`;
    case "moved_project":
      return `přesunul/a kartu do projektu „${to ?? "?"}"`;
    case "due_changed":
      return to ? `nastavil/a termín na ${to}` : "zrušil/a termín";
    case "priority_changed":
      return `změnil/a prioritu na P${to}`;
    case "completed":
      return "dokončil/a kartu";
    case "reopened":
      return "znovu otevřel/a kartu";
    case "assigned":
      return `přiřadil/a ${(m.user as string) ?? "kolegu"}`;
    case "unassigned":
      return `odebral/a ${(m.user as string) ?? "kolegu"}`;
    case "followup_set":
      return `nastavil/a čekání na ${(m.who as string) ?? "?"}`;
    case "followup_cleared":
      return `zrušil/a čekání na ${(m.who as string) ?? "?"}`;
    default:
      return "upravil/a kartu";
  }
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** @tagy v textu komentáře zvýrazní barvou akcentu. */
function CommentBody({ body }: { body: string }) {
  const parts = body.split(/(@[a-z0-9_.]{2,30})/gi);
  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((part, i) =>
        /^@[a-z0-9_.]{2,30}$/i.test(part) ? (
          <span key={i} className="font-medium text-accent">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </p>
  );
}

export default function CardModal({
  task,
  members,
  userId,
  onClose,
  onChanged,
}: {
  task: Task;
  members: Membership[];
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [projectId, setProjectId] = useState(task.project_id);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignees, setAssignees] = useState<Set<string>>(new Set());
  const [ghostAssignees, setGhostAssignees] = useState<Set<string>>(new Set());
  const [projectMembers, setProjectMembers] = useState<Set<string>>(new Set());
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState(task.priority ?? 4);
  const [recurrence, setRecurrence] = useState<string>(task.recurrence ?? "");
  const [done, setDone] = useState(!!task.completed_at);
  const [isPrivate, setIsPrivate] = useState(!!task.is_private);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [newComment, setNewComment] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [taskLabels, setTaskLabels] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  // follow-up „čekám na" — člen nebo externí kontakt (viz CONCEPT-delegovane.md)
  const [followup, setFollowup] = useState<TaskFollowup | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // našeptávač @zmínek v komentáři
  const commentRef = useRef<HTMLInputElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActive, setMentionActive] = useState(0);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadComments = useCallback(async () => {
    const { data } = await supabase
      .from("task_comments")
      .select("*, profiles(full_name, email)")
      .eq("task_id", task.id)
      .order("created_at");
    setComments((data as TaskComment[]) ?? []);
  }, [supabase, task.id]);

  const loadActivity = useCallback(async () => {
    const { data, error } = await supabase
      .from("task_activity")
      .select("*, profiles(full_name, email)")
      .eq("task_id", task.id)
      .order("created_at");
    if (error) return; // tabulka nemusí existovat před migrací
    setActivity((data as TaskActivity[]) ?? []);
  }, [supabase, task.id]);

  const loadLabels = useCallback(async () => {
    const [allRes, mineRes] = await Promise.all([
      supabase
        .from("labels")
        .select("*")
        .eq("workspace_id", task.workspace_id)
        .order("name"),
      supabase.from("task_labels").select("label_id").eq("task_id", task.id),
    ]);
    setLabels((allRes.data as Label[]) ?? []);
    setTaskLabels(new Set((mineRes.data ?? []).map((r) => r.label_id as string)));
  }, [supabase, task.workspace_id, task.id]);

  const loadSubtasks = useCallback(async () => {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("parent_id", task.id)
      .order("created_at");
    setSubtasks((data as Task[]) ?? []);
  }, [supabase, task.id]);

  const loadFollowup = useCallback(async () => {
    const [fuRes, cRes] = await Promise.all([
      supabase
        .from("task_followups")
        .select("*, contacts(name)")
        .eq("task_id", task.id)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("*")
        .eq("workspace_id", task.workspace_id)
        .order("name"),
    ]);
    if (!fuRes.error) setFollowup((fuRes.data as TaskFollowup) ?? null);
    setContacts((cRes.data as Contact[]) ?? []);
  }, [supabase, task.id, task.workspace_id]);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", task.workspace_id)
      .eq("archived", false)
      .order("position")
      .order("name");
    setProjects((data as Project[]) ?? []);
  }, [supabase, task.workspace_id]);

  const loadAssignees = useCallback(async () => {
    const [mineRes, ghostRes, pmRes, grantRes] = await Promise.all([
      supabase.from("task_assignees").select("user_id").eq("task_id", task.id),
      supabase
        .from("task_contact_assignees")
        .select("contact_id")
        .eq("task_id", task.id),
      task.project_id
        ? supabase
            .from("project_members")
            .select("user_id")
            .eq("project_id", task.project_id)
        : Promise.resolve({ data: [] as { user_id: string }[] }),
      supabase
        .from("assign_grants")
        .select("target_id")
        .eq("workspace_id", task.workspace_id)
        .eq("user_id", userId),
    ]);
    setAssignees(new Set((mineRes.data ?? []).map((r) => r.user_id as string)));
    if (!ghostRes.error)
      setGhostAssignees(
        new Set((ghostRes.data ?? []).map((r) => r.contact_id as string))
      );
    setProjectMembers(new Set((pmRes.data ?? []).map((r) => r.user_id as string)));
    setGrants(new Set((grantRes.data ?? []).map((r) => r.target_id as string)));
  }, [supabase, task.id, task.project_id, task.workspace_id, userId]);

  useEffect(() => {
    loadComments();
    loadActivity();
    loadLabels();
    loadSubtasks();
    loadAssignees();
    loadProjects();
    loadFollowup();
  }, [
    loadComments,
    loadActivity,
    loadLabels,
    loadSubtasks,
    loadAssignees,
    loadProjects,
    loadFollowup,
  ]);

  // kdo smí měnit čí přiřazení: admin komukoli, člen sobě + s grantem
  const me = members.find((m) => m.user_id === userId);
  const isAdmin = !!(me?.profiles?.is_super_admin || me?.role === "admin");
  const canManage = (id: string) => isAdmin || id === userId || grants.has(id);

  // delegace („Čekám na") je odemknutá adminům a členům s can_delegate
  const canDelegate = isAdmin || !!me?.can_delegate;
  // skryté úkoly smí přepínat jen autor s odemknutou funkcí (adminům vždy)
  const canTogglePrivate =
    task.created_by === userId && (isAdmin || !!me?.can_hide);

  // admin smí přiřadit kohokoli z firmy (nečlena projektu na projekt doplníme
  // při přiřazení, jinak by úkol neviděl); člen vybírá jen z členů projektu.
  // Úkol bez projektu: kdokoli z firmy. Skrytý úkol vidí autor + řešitelé.
  const assignable =
    isAdmin || !task.project_id
      ? members
      : members.filter((m) => projectMembers.has(m.user_id) || m.role === "admin");

  async function toggleAssignee(targetId: string) {
    const wasOn = assignees.has(targetId);
    setAssignees((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(targetId);
      else next.add(targetId);
      return next;
    });

    if (wasOn) {
      const { error } = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", task.id)
        .eq("user_id", targetId);
      if (error) {
        toast("Změna řešitele se nezdařila.", "error");
        loadAssignees();
      }
      return;
    }

    // řešitel musí být člen projektu, jinak by úkol vůbec neviděl (RLS).
    // Admin proto nečlena při přiřazení rovnou doplní na projekt.
    if (task.project_id && isAdmin && !projectMembers.has(targetId)) {
      const { error: pmError } = await supabase
        .from("project_members")
        .upsert(
          { project_id: task.project_id, user_id: targetId },
          { onConflict: "project_id,user_id", ignoreDuplicates: true }
        );
      if (pmError) {
        toast("Nepodařilo se přidat uživatele na projekt.", "error");
        setAssignees((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        return;
      }
      setProjectMembers((prev) => new Set(prev).add(targetId));
    }

    const { error } = await supabase
      .from("task_assignees")
      .insert({ task_id: task.id, user_id: targetId });
    if (error) {
      toast("Změna řešitele se nezdařila.", "error");
      loadAssignees();
      return;
    }
    pingNotifyEmails();
  }

  // ---------------------------------------------------------------- follow-up

  /** value: "u:<userId>" (člen) nebo "c:<contactId>" (kontakt). */
  async function startWaiting(value: string) {
    if (!value) return;
    const id = value.slice(2);
    const { error } = await supabase.from("task_followups").insert({
      task_id: task.id,
      workspace_id: task.workspace_id,
      created_by: userId,
      waiting_user_id: value.startsWith("u:") ? id : null,
      waiting_contact_id: value.startsWith("c:") ? id : null,
    });
    if (error) {
      toast("Čekání se nepodařilo nastavit.", "error");
      return;
    }
    loadFollowup();
    loadActivity();
    notifyTasksChanged(); // úkol se přesouvá z Moje úkoly na stránku Čekám na
  }

  async function stopWaiting() {
    const { error } = await supabase
      .from("task_followups")
      .delete()
      .eq("task_id", task.id);
    if (error) {
      toast("Zrušení čekání se nezdařilo.", "error");
      return;
    }
    loadFollowup();
    loadActivity();
    notifyTasksChanged();
  }

  /** Nový duch z „➕ založit" v PersonPickeru — jen doplnit do seznamu. */
  function addContact(contact: Contact) {
    setContacts((prev) =>
      [...prev, contact].sort((a, b) => a.name.localeCompare(b.name, "cs"))
    );
  }

  /** „➕ založit projekt" z pickeru v hlavičce (jen admin — RLS). */
  async function createProjectAndSelect(name: string) {
    const { data, error } = await supabase
      .from("projects")
      .insert({ workspace_id: task.workspace_id, name })
      .select("id")
      .single();
    if (error || !data) {
      toast("Projekt se nepodařilo založit.", "error");
      return;
    }
    await loadProjects();
    setProjectId(data.id as string);
  }

  /** Duch jako řešitel — jen evidence, kartu nevidí a nedostává notifikace. */
  async function toggleGhost(contactId: string) {
    const wasOn = ghostAssignees.has(contactId);
    setGhostAssignees((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
    const { error } = wasOn
      ? await supabase
          .from("task_contact_assignees")
          .delete()
          .eq("task_id", task.id)
          .eq("contact_id", contactId)
      : await supabase
          .from("task_contact_assignees")
          .insert({ task_id: task.id, contact_id: contactId });
    if (error) {
      toast("Změna řešitele se nezdařila.", "error");
      loadAssignees();
    }
  }

  async function save() {
    const projectChanged = projectId !== task.project_id;
    const patch: Record<string, unknown> = {
      title: title.trim() || task.title,
      description,
      due_date: dueDate || null,
      priority,
      recurrence: (recurrence || null) as Recurrence | null,
      completed_at: done
        ? (task.completed_at ?? new Date().toISOString())
        : null,
      project_id: projectId,
      is_private: isPrivate,
    };
    // cílový projekt má vlastní sloupce → kartu vyřadíme ze sloupce, board ji
    // při načtení zařadí do prvního sloupce nového projektu
    if (projectChanged) patch.column_id = null;


    const { error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", task.id);
    if (error) {
      setError("Uložení se nezdařilo.");
      return;
    }
    // podúkoly patří k rodiči — přesuň je do stejného projektu
    if (projectChanged) {
      await supabase
        .from("tasks")
        .update({ project_id: projectId })
        .eq("parent_id", task.id);
    }
    pingNotifyEmails(); // dokončení opakované karty přiřazuje další výskyt
    onChanged();
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Smazat kartu?",
      message: `Karta „${task.title}" se smaže včetně všech záznamů času a komentářů. Tuto akci nelze vrátit.`,
    });
    if (!ok) return;
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      setError("Smazat kartu může jen její autor nebo admin.");
      return;
    }
    onChanged();
  }

  // ---------------------------------------------------------------- štítky

  async function toggleLabel(label: Label) {
    const wasOn = taskLabels.has(label.id);
    setTaskLabels((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(label.id);
      else next.add(label.id);
      return next;
    });
    const { error } = wasOn
      ? await supabase
          .from("task_labels")
          .delete()
          .eq("task_id", task.id)
          .eq("label_id", label.id)
      : await supabase
          .from("task_labels")
          .insert({ task_id: task.id, label_id: label.id });
    if (error) {
      toast("Změna štítku se nezdařila.", "error");
      loadLabels();
    }
  }

  async function createLabel(e: React.FormEvent) {
    e.preventDefault();
    const name = newLabel.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("labels")
      .insert({ workspace_id: task.workspace_id, name })
      .select("id")
      .single();
    if (error || !data) {
      toast("Štítek se nepodařilo založit (možná už existuje).", "error");
      return;
    }
    await supabase.from("task_labels").insert({ task_id: task.id, label_id: data.id });
    setNewLabel("");
    setAddingLabel(false);
    loadLabels();
  }

  // ---------------------------------------------------------------- podúkoly

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    const name = newSubtask.trim();
    if (!name) return;
    const { error } = await supabase.from("tasks").insert({
      workspace_id: task.workspace_id,
      project_id: task.project_id,
      parent_id: task.id,
      title: name,
    });
    if (error) {
      toast("Podúkol se nepodařilo přidat.", "error");
      return;
    }
    setNewSubtask("");
    loadSubtasks();
  }

  async function toggleSubtask(sub: Task) {
    await supabase
      .from("tasks")
      .update({ completed_at: sub.completed_at ? null : new Date().toISOString() })
      .eq("id", sub.id);
    loadSubtasks();
  }

  async function removeSubtask(sub: Task) {
    await supabase.from("tasks").delete().eq("id", sub.id);
    loadSubtasks();
  }

  // ---------------------------------------------------------------- komentáře

  // ---------------------------------------------------------------- zmínky

  const mentionSuggestions =
    mentionQuery === null
      ? []
      : members
          .filter((m) => m.profiles?.tag_name)
          .filter((m) => {
            const q = mentionQuery.toLowerCase();
            return (
              m.profiles!.tag_name!.toLowerCase().startsWith(q) ||
              (m.profiles?.full_name ?? "").toLowerCase().includes(q)
            );
          })
          .slice(0, 6);

  function onCommentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setNewComment(value);
    const caret = e.target.selectionStart ?? value.length;
    const match = value.slice(0, caret).match(/@([a-zA-Z0-9_.]{0,30})$/);
    setMentionQuery(match ? match[1] : null);
    setMentionActive(0);
  }

  function pickMention(tag: string) {
    const caret = commentRef.current?.selectionStart ?? newComment.length;
    const before = newComment
      .slice(0, caret)
      .replace(/@[a-zA-Z0-9_.]{0,30}$/, `@${tag} `);
    setNewComment(before + newComment.slice(caret));
    setMentionQuery(null);
    commentRef.current?.focus();
  }

  function onCommentKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (mentionQuery === null || mentionSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionActive((i) => Math.min(i + 1, mentionSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickMention(mentionSuggestions[mentionActive].profiles!.tag_name!);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    setMentionQuery(null);
    if (!newComment.trim()) return;
    await supabase.from("task_comments").insert({
      workspace_id: task.workspace_id,
      task_id: task.id,
      body: newComment.trim(),
    });
    setNewComment("");
    pingNotifyEmails();
    loadComments();
  }

  async function removeComment(comment: TaskComment) {
    await supabase.from("task_comments").delete().eq("id", comment.id);
    loadComments();
  }

  async function play() {
    await startTimer(supabase, userId, {
      workspace_id: task.workspace_id,
      project_id: task.project_id,
      task_id: task.id,
      task_title: task.title,
    });
    onClose();
  }

  const doneSubtasks = subtasks.filter((s) => s.completed_at).length;

  // jméno čekaného: člen z members, kontakt z embedded contacts
  const waitingMember = followup?.waiting_user_id
    ? members.find((m) => m.user_id === followup.waiting_user_id)
    : null;
  const waitingName = followup
    ? followup.waiting_user_id
      ? waitingMember?.profiles?.full_name || waitingMember?.profiles?.email || "člen"
      : (followup.contacts?.name ?? "kontakt")
    : null;
  const followupSetter = followup
    ? members.find((m) => m.user_id === followup.created_by)
    : null;
  const canClearWaiting =
    !!followup && (followup.created_by === userId || isAdmin);

  // komentáře + systémová aktivita v jednom časovém toku
  const timeline: {
    id: string;
    at: string;
    comment?: TaskComment;
    act?: TaskActivity;
  }[] = [
    ...comments.map((c) => ({ id: `c-${c.id}`, at: c.created_at, comment: c })),
    ...activity.map((a) => ({ id: `a-${a.id}`, at: a.created_at, act: a })),
  ].sort((x, y) => x.at.localeCompare(y.at));

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-black/40 sm:items-start sm:p-10"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Karta: ${task.title}`}
        tabIndex={-1}
        className="pb-safe flex w-full flex-col bg-surface shadow-xl outline-none sm:h-[86vh] sm:max-w-4xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* horní lišta: projekt (přesun karty mezi projekty) + zavřít */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          {(isAdmin || (!task.project_id && task.created_by === userId)) &&
          projects.length > 0 ? (
            <ProjectPicker
              projects={projects}
              value={projectId}
              onChange={setProjectId}
              align="left"
              alwaysSearch
              onCreate={isAdmin ? createProjectAndSelect : undefined}
            />
          ) : (
            <span className="chip max-w-[65%] truncate px-2 py-1 text-sm">
              {projects.find((p) => p.id === projectId)?.name ?? "Bez projektu"}
            </span>
          )}
          {isPrivate && (
            <span
              className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-ink-soft"
              title="Skrytý úkol — vidí ho jen autor a řešitelé."
            >
              🔒 skrytý
            </span>
          )}
          <span className="flex-1" />
          <button
            onClick={onClose}
            aria-label="Zavřít kartu"
            className="rounded-md px-2 py-1 text-ink-soft/70 hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        {/* tělo: obsah vlevo, komentáře/aktivita vpravo (na mobilu pod sebou) */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row sm:overflow-hidden">
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={done}
                onChange={(e) => setDone(e.target.checked)}
                className="mt-1.5 h-4 w-4"
                title="Hotovo"
              />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold hover:border-line focus:border-line"
              />
            </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Popis…"
          rows={4}
          className="input w-full px-3 py-2"
        />

        {/* jednotný vzor: přiřazení = chipy (klik odebere), přidání = kombobox */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft/70">Řešitelé:</span>
          {assignees.size === 0 && ghostAssignees.size === 0 && (
            <span className="text-xs text-ink-soft/50">nikdo</span>
          )}
          {members
            .filter((m) => assignees.has(m.user_id))
            .map((m) => {
              const name = m.profiles?.full_name || m.profiles?.email || "?";
              // bez oprávnění: cizí přiřazení jen zobrazit
              if (!canManage(m.user_id)) {
                return (
                  <span
                    key={m.user_id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-accent/70 py-0.5 pl-0.5 pr-2 text-xs text-white"
                    title="Přiřazení může změnit admin nebo pověřený kolega"
                  >
                    <Avatar profile={m.profiles} colorKey={m.user_id} size="xs" />
                    {name}
                  </span>
                );
              }
              return (
                <button
                  key={m.user_id}
                  onClick={() => toggleAssignee(m.user_id)}
                  title="Kliknutím odebereš"
                  className="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-accent py-0.5 pl-0.5 pr-2 text-xs text-white transition-colors hover:bg-accent/80"
                >
                  <Avatar profile={m.profiles} colorKey={m.user_id} size="xs" />
                  {name}
                </button>
              );
            })}
          {/* duší řešitelé — jen evidence, kartu nevidí */}
          {contacts
            .filter((c) => ghostAssignees.has(c.id))
            .map((c) => (
              <button
                key={c.id}
                onClick={() => toggleGhost(c.id)}
                title="Duch — kartu nevidí, odškrtává za něj zadavatel. Kliknutím odebereš."
                className="inline-flex items-center gap-1 rounded-full border border-transparent bg-ink-soft/80 px-2 py-0.5 text-xs text-white"
              >
                👻 {c.name}
              </button>
            ))}
          <PersonPicker
            wsId={task.workspace_id}
            userId={userId}
            members={assignable.filter((m) => canManage(m.user_id))}
            contacts={contacts}
            value={null}
            onChange={(ref) =>
              ref &&
              (isMemberRef(ref)
                ? toggleAssignee(personRefId(ref))
                : toggleGhost(personRefId(ref)))
            }
            onContactCreated={addContact}
            excludeRefs={
              new Set([
                ...[...assignees].map((id) => `u:${id}`),
                ...[...ghostAssignees].map((id) => `c:${id}`),
              ])
            }
            placeholder="+ řešitel"
            ariaLabel="Přidat řešitele"
          />
        </div>

        {/* follow-up: úkol čeká na dodání členem či externím kontaktem;
            nastavují jen delegátoři (admin / can_delegate), chip vidí všichni */}
        {(canDelegate || followup) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft/70">Čekám na:</span>
          {followup ? (
            <>
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                title={`Follow-up nastavil/a ${
                  followupSetter?.profiles?.full_name ||
                  followupSetter?.profiles?.email ||
                  "kolega"
                }`}
              >
                ⏳ {waitingName}
                <span className="text-amber-800/60">
                  od{" "}
                  {new Date(followup.created_at).toLocaleDateString("cs-CZ", {
                    day: "numeric",
                    month: "numeric",
                  })}
                </span>
              </span>
              {canClearWaiting && (
                <button
                  onClick={stopWaiting}
                  className="rounded-full px-2 py-0.5 text-xs text-ink-soft/70 hover:bg-black/5"
                >
                  Zrušit čekání
                </button>
              )}
            </>
          ) : (
            <PersonPicker
              wsId={task.workspace_id}
              userId={userId}
              members={members}
              contacts={contacts}
              value={null}
              onChange={(ref) => ref && startWaiting(ref)}
              onContactCreated={addContact}
              includeMe={false}
              placeholder="nastavit follow-up"
              ariaLabel="Čekám na"
              iconPath={HOURGLASS_ICON}
            />
          )}
        </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Termín"
            className="input px-2 py-1"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            aria-label="Priorita"
            style={{ color: priorityColor(priority) ?? undefined }}
            className="input px-2"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            aria-label="Opakování"
            className="input px-2"
          >
            {RECURRENCE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            onClick={play}
            className="rounded-md border border-accent/50 px-3 py-1.5 text-sm text-accent hover:bg-accent-soft"
          >
            ▶ Spustit timer
          </button>
          {canTogglePrivate && (
            <label
              className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-soft"
              title="Skrytý úkol vidí jen autor a řešitelé — nikdo jiný, ani admin."
            >
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="h-4 w-4"
              />
              🔒 Skrytý
            </label>
          )}
        </div>
        {recurrence && (
          <p className="text-xs text-ink-soft/70">
            Po dokončení se automaticky založí další výskyt s posunutým termínem.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {labels.map((label) => {
            const on = taskLabels.has(label.id);
            return (
              <button
                key={label.id}
                onClick={() => toggleLabel(label)}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  on
                    ? "border-transparent text-white"
                    : "border-line text-ink-soft hover:border-ink-soft/40"
                }`}
                style={on ? { background: projectColor(label.id) } : undefined}
              >
                {label.name}
              </button>
            );
          })}
          {addingLabel ? (
            <form onSubmit={createLabel} className="inline-flex gap-1">
              <input
                autoFocus
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onBlur={() => !newLabel.trim() && setAddingLabel(false)}
                placeholder="Název štítku…"
                className="input w-32 px-2 py-0.5 text-xs"
              />
              <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
                OK
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAddingLabel(true)}
              className="rounded-full px-2 py-0.5 text-xs text-ink-soft/70 hover:bg-black/5"
            >
              + štítek
            </button>
          )}
        </div>

        <div className="space-y-1.5 border-t border-line/70 pt-3">
          <h3 className="text-sm font-semibold">
            Podúkoly
            {subtasks.length > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-soft/70">
                {doneSubtasks}/{subtasks.length}
              </span>
            )}
          </h3>
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!sub.completed_at}
                onChange={() => toggleSubtask(sub)}
                className="h-3.5 w-3.5"
              />
              <span
                className={`flex-1 text-sm ${
                  sub.completed_at ? "text-ink-soft/70 line-through" : ""
                }`}
              >
                {sub.title}
              </span>
              <button
                onClick={() => removeSubtask(sub)}
                aria-label={`Smazat podúkol ${sub.title}`}
                className="rounded px-1.5 text-xs text-ink-soft/50 hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
          <form onSubmit={addSubtask} className="flex gap-2">
            <input
              type="text"
              placeholder="+ Přidat podúkol…"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              className="input-quiet flex-1 px-2 py-1 text-sm"
            />
            {newSubtask.trim() && (
              <button type="submit" className="btn-primary px-2 py-0.5 text-xs">
                OK
              </button>
            )}
          </form>
        </div>

            <CardChecklists taskId={task.id} workspaceId={task.workspace_id} />

            <CardAttachments
              taskId={task.id}
              workspaceId={task.workspace_id}
              userId={userId}
            />

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          {/* pravý panel: komentáře a aktivita */}
          <div className="flex w-full shrink-0 flex-col border-t border-line bg-paper/40 sm:w-80 sm:overflow-hidden sm:border-l sm:border-t-0 lg:w-96">
            <h3 className="border-b border-line px-4 py-2.5 text-sm font-semibold">
              Komentáře a aktivita
            </h3>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {timeline.length === 0 && (
                <p className="text-xs text-ink-soft/70">Zatím žádná aktivita.</p>
              )}
              {timeline.map((row) =>
                row.comment ? (
                  <div key={row.id} className="rounded-lg border border-line bg-surface p-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium">
                        {row.comment.profiles?.full_name ||
                          row.comment.profiles?.email}
                      </span>
                      <span className="text-[10px] text-ink-soft/70">
                        {fmtStamp(row.comment.created_at)}
                      </span>
                      {row.comment.author_id === userId && (
                        <button
                          onClick={() => removeComment(row.comment!)}
                          className="ml-auto text-[10px] text-ink-soft/70 hover:text-danger"
                        >
                          smazat
                        </button>
                      )}
                    </div>
                    <CommentBody body={row.comment.body} />
                  </div>
                ) : (
                  <p key={row.id} className="px-1 text-xs text-ink-soft/70">
                    <span className="font-medium text-ink-soft">
                      {row.act!.profiles?.full_name ||
                        row.act!.profiles?.email ||
                        "Systém"}
                    </span>{" "}
                    {activityText(row.act!)}
                    <span className="text-ink-soft/50">
                      {" · "}
                      {fmtStamp(row.act!.created_at)}
                    </span>
                  </p>
                )
              )}
            </div>
            <form onSubmit={addComment} className="flex gap-2 border-t border-line p-3">
            <div className="relative flex-1">
              {mentionQuery !== null && mentionSuggestions.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Zmínit uživatele"
                  className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg"
                >
                  {mentionSuggestions.map((m, i) => (
                    <li key={m.user_id} role="option" aria-selected={i === mentionActive}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // neztratit fokus inputu
                          pickMention(m.profiles!.tag_name!);
                        }}
                        onMouseEnter={() => setMentionActive(i)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                          i === mentionActive ? "bg-accent-soft" : ""
                        }`}
                      >
                        <Avatar
                          profile={m.profiles}
                          colorKey={m.user_id}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {m.profiles?.full_name || m.profiles?.email}
                        </span>
                        <span className="text-xs text-accent">
                          @{m.profiles?.tag_name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                ref={commentRef}
                type="text"
                placeholder="Napsat komentář… (@ zmíní kolegu)"
                value={newComment}
                onChange={onCommentChange}
                onKeyDown={onCommentKeyDown}
                onBlur={() => setMentionQuery(null)}
                className="w-full input"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
            >
              Odeslat
            </button>
            </form>
          </div>
        </div>

        {/* patička přes celou šířku */}
        <div className="flex items-center justify-between border-t border-line px-3 py-2.5 sm:px-4">
          <button
            onClick={remove}
            className="rounded-md px-2 py-1 text-sm text-danger hover:bg-danger/10"
          >
            Smazat kartu
          </button>
          <button onClick={save} className="btn-primary">
            Uložit
          </button>
        </div>
      </div>
    </div>
  );
}
