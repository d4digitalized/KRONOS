"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { posBetween } from "@/lib/position";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { PRIORITIES } from "@/lib/priority";
import ProjectPicker from "@/components/ProjectPicker";
import PersonPicker, {
  HOURGLASS_ICON,
  isMemberRef,
  personRefId,
  type PersonRef,
} from "@/components/PersonPicker";
import type { Contact, Membership, Project } from "@/lib/types";

/** Rychlé založení úkolu. Řešitel je předvyplněný na mě; koho smím přiřadit
    navíc, řeší role (admin) a granty — stejná pravidla jako v kartě.
    Řešitelem může být i duch (externí kontakt bez účtu). Bez projektu =
    soukromý úkol (vidí autor + řešitelé). Delegátoři mají navíc pole
    „Čekám na" (follow-up), skrývači zaškrtávátko skrytého úkolu. */
export default function NewTaskDialog({
  wsId,
  userId,
  canDelegate = false,
  canHide = false,
  onClose,
  onCreated,
}: {
  wsId: string;
  userId: string;
  canDelegate?: boolean;
  canHide?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  // řešitel a follow-up jako PersonRef ("u:<userId>" | "c:<contactId>")
  const [assignee, setAssignee] = useState<PersonRef | null>(`u:${userId}`);
  const [waitSel, setWaitSel] = useState<PersonRef | null>(null);
  const [assignToo, setAssignToo] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState(4);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [projectMembers, setProjectMembers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", wsId)
        .eq("archived", false)
        .order("position")
        .order("name"),
      supabase
        .from("workspace_members")
        .select(
          "*, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      supabase
        .from("assign_grants")
        .select("target_id")
        .eq("workspace_id", wsId)
        .eq("user_id", userId),
      supabase.from("contacts").select("*").eq("workspace_id", wsId).order("name"),
    ]).then(([projRes, memRes, grantRes, contactRes]) => {
      const list = (projRes.data as Project[]) ?? [];
      setProjects(list);
      if (list.length === 1) setProjectId(list[0].id); // jediný projekt předvyber
      setMembers((memRes.data as unknown as Membership[]) ?? []);
      setGrants(new Set((grantRes.data ?? []).map((r) => r.target_id as string)));
      setContacts((contactRes.data as Contact[]) ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, userId]);

  // členy projektu potřebujeme pro omezení řešitelů u neadmina
  useEffect(() => {
    if (!projectId) {
      setProjectMembers(new Set());
      return;
    }
    supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .then(({ data }) =>
        setProjectMembers(new Set((data ?? []).map((r) => r.user_id as string)))
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const me = members.find((m) => m.user_id === userId);
  const isAdmin = !!(me?.profiles?.is_super_admin || me?.role === "admin");
  const canManage = (id: string) => isAdmin || id === userId || grants.has(id);

  // admin přiřazuje komukoli z firmy, ostatní jen sobě a lidem s grantem
  // (u projektového úkolu navíc jen z členů projektu — jinak by úkol
  // kvůli RLS neviděli; úkol bez projektu vidí každý řešitel)
  const candidates =
    isAdmin || !projectId
      ? members
      : members.filter(
          (m) =>
            m.user_id === userId ||
            projectMembers.has(m.user_id) ||
            m.role === "admin"
        );
  const assignable = candidates.filter((m) => canManage(m.user_id));

  function addContact(contact: Contact) {
    setContacts((prev) =>
      [...prev, contact].sort((a, b) => a.name.localeCompare(b.name, "cs"))
    );
  }

  function pickWait(ref: PersonRef | null) {
    setAssignToo(false);
    setWaitSel(ref);
  }

  // ---------------------------------------------------------------- uložení

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    setSaving(true);

    // projektový úkol jde na konec prvního sloupce nástěnky projektu;
    // úkol bez projektu žije mimo nástěnky (column_id null)
    let columnId: string | null = null;
    let position = 0;
    if (projectId) {
      const [{ data: col }, { data: last }] = await Promise.all([
        supabase
          .from("board_columns")
          .select("id")
          .eq("project_id", projectId)
          .order("position")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("tasks")
          .select("position")
          .eq("project_id", projectId)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      columnId = col?.id ?? null;
      position = posBetween(last?.position, undefined);
    }

    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: wsId,
        project_id: projectId,
        column_id: columnId,
        title: name,
        due_date: dueDate || null,
        priority,
        position,
        is_private: isPrivate,
      })
      .select("id")
      .single();

    if (error || !created) {
      setSaving(false);
      toast("Úkol se nepodařilo přidat.", "error");
      return;
    }

    // řešitelé: vybraný + případně čekaný („zadat mu to i jako úkol");
    // členové → task_assignees (+ notifikace), duchové → task_contact_assignees
    const refs = new Set<PersonRef>();
    if (assignee) refs.add(assignee);
    if (assignToo && waitSel) refs.add(waitSel);

    for (const ref of refs) {
      const id = personRefId(ref);
      if (isMemberRef(ref)) {
        // řešitel musí být člen projektu (RLS) — admin nečlena rovnou doplní
        if (projectId && isAdmin && !projectMembers.has(id)) {
          await supabase
            .from("project_members")
            .upsert(
              { project_id: projectId, user_id: id },
              { onConflict: "project_id,user_id", ignoreDuplicates: true }
            );
        }
        const { error: taError } = await supabase
          .from("task_assignees")
          .insert({ task_id: created.id, user_id: id });
        if (taError) toast("Řešitele se nepodařilo přiřadit.", "error");
      } else {
        const { error: tcaError } = await supabase
          .from("task_contact_assignees")
          .insert({ task_id: created.id, contact_id: id });
        if (tcaError) toast("Ducha se nepodařilo přiřadit.", "error");
      }
    }
    if ([...refs].some(isMemberRef)) pingNotifyEmails();

    // follow-up: čekám na člena / kontakt
    if (canDelegate && waitSel) {
      const id = personRefId(waitSel);
      const { error: fuError } = await supabase.from("task_followups").insert({
        task_id: created.id,
        workspace_id: wsId,
        created_by: userId,
        waiting_user_id: isMemberRef(waitSel) ? id : null,
        waiting_contact_id: isMemberRef(waitSel) ? null : id,
      });
      if (fuError) toast("Follow-up se nepodařilo nastavit.", "error");
    }

    setSaving(false);
    toast(`Úkol přidán: ${name}`);
    onCreated();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Nový úkol"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-xl bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <h2 className="flex-1 font-display text-lg font-semibold">Nový úkol</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            className="rounded-md px-2 py-1 text-ink-soft/70 hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        <input
          ref={titleRef}
          type="text"
          placeholder="Co je potřeba udělat?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input w-full px-3 py-2 text-base"
        />

        <div className="flex flex-wrap items-center gap-2">
          <ProjectPicker
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            align="left"
            alwaysSearch
          />
          <PersonPicker
            wsId={wsId}
            userId={userId}
            members={assignable}
            contacts={contacts}
            value={assignee}
            onChange={setAssignee}
            onContactCreated={addContact}
            noneLabel="Bez řešitele"
            placeholder="Řešitel"
            ariaLabel="Řešitel"
          />
        </div>

        {/* follow-up: koho dodávku hlídám (nezávislé na řešiteli) */}
        {canDelegate && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-soft">⏳ Čekám na</span>
              <PersonPicker
                wsId={wsId}
                userId={userId}
                members={members}
                contacts={contacts}
                value={waitSel}
                onChange={pickWait}
                onContactCreated={addContact}
                includeMe={false}
                noneLabel="— nikdo —"
                placeholder="nikdo (nepovinné)"
                ariaLabel="Čekám na"
                iconPath={HOURGLASS_ICON}
              />
            </div>

            {/* čekaný člověk zatím není řešitel → nabídni zadání */}
            {waitSel && waitSel !== assignee && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={assignToo}
                  onChange={(e) => setAssignToo(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                {isMemberRef(waitSel)
                  ? "zadat mu to i jako úkol (uvidí ho a dostane upozornění)"
                  : "přidat ho i jako řešitele (jen evidence, duch nic nevidí)"}
              </label>
            )}

            {/* zkratka z druhé strany: řešitel je někdo jiný → pohlídat dodání */}
            {!waitSel && assignee && assignee !== `u:${userId}` && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={(e) => setWaitSel(e.target.checked ? assignee : null)}
                  className="h-3.5 w-3.5"
                />
                Follow-up — pohlídat dodání na stránce Čekám na
              </label>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-ink-soft">
            Termín{" "}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input ml-1 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm text-ink-soft">
            Priorita{" "}
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="input ml-1 px-2 py-1 text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {canHide && (
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

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Zrušit
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="btn-primary"
          >
            {saving ? "Ukládám…" : "Přidat úkol"}
          </button>
        </div>
      </form>
    </div>
  );
}
