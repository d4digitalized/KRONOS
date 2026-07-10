"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { posBetween } from "@/lib/position";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { PRIORITIES } from "@/lib/priority";
import ProjectPicker from "@/components/ProjectPicker";
import Picker from "@/components/Picker";
import type { Contact, Membership, Project } from "@/lib/types";

const USER_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const HOURGLASS_ICON = "M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4";

/** Vybraný cíl follow-upu: člen (u), nebo externí kontakt (c). */
type WaitTarget =
  | { kind: "u"; id: string; name: string }
  | { kind: "c"; id: string; name: string };

/** Rychlé založení úkolu. Řešitel je předvyplněný na mě; koho smím přiřadit
    navíc, řeší role (admin) a granty — stejná pravidla jako v kartě.
    Bez projektu = soukromý úkol (vidí autor + řešitelé). Delegátoři mají
    navíc pole „Čekám na" (follow-up), skrývači zaškrtávátko skrytého úkolu. */
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
  // řešitel: "u:<userId>" (člen) nebo "c:<contactId>" (duch); null = bez řešitele
  const [assignee, setAssignee] = useState<string | null>(`u:${userId}`);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState(4);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [projectMembers, setProjectMembers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // follow-up „čekám na": vybraný cíl + „zadat mu to i jako úkol"
  const [waitSel, setWaitSel] = useState<WaitTarget | null>(null);
  const [assignToo, setAssignToo] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
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
  }, [wsId, userId, canDelegate]);

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
  const memberName = (m: Membership) =>
    m.profiles?.full_name || m.profiles?.email || "?";

  // rozklad řešitele na člena/ducha
  const assigneeMember = assignee?.startsWith("u:") ? assignee.slice(2) : null;
  const assigneeGhost = assignee?.startsWith("c:") ? assignee.slice(2) : null;

  // ---------------------------------------------------------------- čekám na

  /** id z pickeru: "u:<userId>" / "c:<contactId>" / null = zrušit. */
  function pickWait(id: string | null) {
    setAssignToo(false);
    if (!id) {
      setWaitSel(null);
      return;
    }
    const raw = id.slice(2);
    if (id.startsWith("u:")) {
      const m = members.find((x) => x.user_id === raw);
      if (m) setWaitSel({ kind: "u", id: raw, name: memberName(m) });
    } else {
      const c = contacts.find((x) => x.id === raw);
      if (c) setWaitSel({ kind: "c", id: raw, name: c.name });
    }
  }

  /** Založí ducha a přidá ho do lokálního seznamu kontaktů. */
  async function createContact(name: string): Promise<Contact | null> {
    const { data, error } = await supabase
      .from("contacts")
      .insert({ workspace_id: wsId, name, created_by: userId })
      .select("id")
      .single();
    if (error || !data) {
      toast("Kontakt se nepodařilo založit.", "error");
      return null;
    }
    const contact = {
      id: data.id as string,
      workspace_id: wsId,
      name,
      email: "",
      note: "",
      created_by: userId,
      created_at: "",
    } as Contact;
    setContacts((prev) =>
      [...prev, contact].sort((a, b) => a.name.localeCompare(b.name, "cs"))
    );
    return contact;
  }

  /** „➕ založit kontakt" z pickeru Čekám na — založí ho hned a vybere. */
  async function createContactAndPick(name: string) {
    const contact = await createContact(name);
    if (!contact) return;
    setAssignToo(false);
    setWaitSel({ kind: "c", id: contact.id, name });
  }

  /** Follow-up přepínač u cizího řešitele (člen i duch): čekám na = řešitel. */
  function toggleFollowUpOnAssignee(on: boolean) {
    if (!on) {
      setWaitSel(null);
      return;
    }
    if (assigneeMember) {
      const m = members.find((x) => x.user_id === assigneeMember);
      if (m) setWaitSel({ kind: "u", id: m.user_id, name: memberName(m) });
    } else if (assigneeGhost) {
      const c = contacts.find((x) => x.id === assigneeGhost);
      if (c) setWaitSel({ kind: "c", id: c.id, name: c.name });
    }
  }

  /** „➕ založit kontakt" z pickeru řešitelů — založí ducha a vybere ho. */
  async function createGhostAndAssign(name: string) {
    const contact = await createContact(name);
    if (contact) setAssignee(`c:${contact.id}`);
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
    const memberIds = new Set<string>();
    const ghostIds = new Set<string>();
    if (assigneeMember) memberIds.add(assigneeMember);
    if (assigneeGhost) ghostIds.add(assigneeGhost);
    if (assignToo && waitSel) {
      if (waitSel.kind === "u") memberIds.add(waitSel.id);
      else ghostIds.add(waitSel.id);
    }

    for (const uid of memberIds) {
      // řešitel musí být člen projektu (RLS) — admin nečlena rovnou doplní
      if (projectId && isAdmin && !projectMembers.has(uid)) {
        await supabase
          .from("project_members")
          .upsert(
            { project_id: projectId, user_id: uid },
            { onConflict: "project_id,user_id", ignoreDuplicates: true }
          );
      }
      const { error: taError } = await supabase
        .from("task_assignees")
        .insert({ task_id: created.id, user_id: uid });
      if (taError) toast("Řešitele se nepodařilo přiřadit.", "error");
    }
    if (memberIds.size > 0) pingNotifyEmails();

    for (const cid of ghostIds) {
      const { error: tcaError } = await supabase
        .from("task_contact_assignees")
        .insert({ task_id: created.id, contact_id: cid });
      if (tcaError) toast("Ducha se nepodařilo přiřadit.", "error");
    }

    // follow-up: čekám na člena / kontakt
    if (canDelegate && waitSel) {
      const { error: fuError } = await supabase.from("task_followups").insert({
        task_id: created.id,
        workspace_id: wsId,
        created_by: userId,
        waiting_user_id: waitSel.kind === "u" ? waitSel.id : null,
        waiting_contact_id: waitSel.kind === "c" ? waitSel.id : null,
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
          />
          <Picker
            options={[
              { id: null, label: "Bez řešitele" },
              ...assignable.map((m) => ({
                id: `u:${m.user_id}` as string | null,
                label:
                  m.user_id === userId
                    ? `${memberName(m)} (já)`
                    : memberName(m),
              })),
              ...contacts.map((c) => ({
                id: `c:${c.id}` as string | null,
                label: `👻 ${c.name}`,
              })),
            ]}
            value={assignee}
            onChange={setAssignee}
            placeholder="Řešitel"
            iconPath={USER_ICON}
            ariaLabel="Řešitel"
            align="left"
            alwaysSearch
            onCreate={createGhostAndAssign}
            createLabel="založit kontakt"
          />
        </div>

        {/* follow-up: koho dodávku hlídám (nezávislé na řešiteli) */}
        {canDelegate && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-soft">⏳ Čekám na</span>
              <Picker
                options={[
                  { id: null, label: "— nikdo —" },
                  ...members
                    .filter((m) => m.user_id !== userId)
                    .map((m) => ({
                      id: `u:${m.user_id}` as string | null,
                      label: `👤 ${memberName(m)}`,
                    })),
                  ...contacts.map((c) => ({
                    id: `c:${c.id}` as string | null,
                    label: `👻 ${c.name}`,
                  })),
                ]}
                value={waitSel ? `${waitSel.kind}:${waitSel.id}` : null}
                onChange={pickWait}
                placeholder="nikdo (nepovinné)"
                iconPath={HOURGLASS_ICON}
                ariaLabel="Čekám na"
                align="left"
                alwaysSearch
                onCreate={createContactAndPick}
                createLabel="založit kontakt"
              />
            </div>

            {/* čekaný člověk zatím není řešitel → nabídni zadání */}
            {waitSel && `${waitSel.kind}:${waitSel.id}` !== assignee && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={assignToo}
                  onChange={(e) => setAssignToo(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                {waitSel.kind === "u"
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
                  onChange={(e) => toggleFollowUpOnAssignee(e.target.checked)}
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
