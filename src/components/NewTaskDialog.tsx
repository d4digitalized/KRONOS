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

/** Vybraný cíl follow-upu: člen (u), kontakt (c), nebo kontakt k založení. */
type WaitTarget =
  | { kind: "u"; id: string; name: string }
  | { kind: "c"; id: string; name: string }
  | { kind: "new"; name: string };

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
  const [assignee, setAssignee] = useState<string | null>(userId);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState(4);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [projectMembers, setProjectMembers] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // follow-up „čekám na": psaný dotaz + vybraný cíl + „zadat mu to i jako úkol"
  const [waitQuery, setWaitQuery] = useState("");
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
      canDelegate
        ? supabase.from("contacts").select("*").eq("workspace_id", wsId).order("name")
        : Promise.resolve({ data: [] as Contact[] }),
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
  const canAssignOthers = assignable.some((m) => m.user_id !== userId);
  const meName = me?.profiles?.full_name || me?.profiles?.email || "já";
  const memberName = (m: Membership) =>
    m.profiles?.full_name || m.profiles?.email || "?";

  // ---------------------------------------------------------------- čekám na

  const q = waitQuery.trim().toLowerCase();
  const memberHits = q
    ? members
        .filter((m) => m.user_id !== userId)
        .filter((m) => memberName(m).toLowerCase().includes(q))
        .slice(0, 4)
    : [];
  const contactHits = q
    ? contacts.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 4)
    : [];
  const exactHit =
    memberHits.some((m) => memberName(m).toLowerCase() === q) ||
    contactHits.some((c) => c.name.toLowerCase() === q);

  function pickWait(sel: WaitTarget) {
    setWaitSel(sel);
    setWaitQuery("");
    // vybraný člen už je řešitelem → není co „zadávat navíc"
    setAssignToo(false);
  }

  /** Follow-up přepínač u cizího řešitele: čekám na = řešitel. */
  function toggleFollowUpOnAssignee(on: boolean) {
    if (!on) {
      setWaitSel(null);
      return;
    }
    const m = members.find((x) => x.user_id === assignee);
    if (m) setWaitSel({ kind: "u", id: m.user_id, name: memberName(m) });
  }

  function togglePrivate(on: boolean) {
    setIsPrivate(on);
    if (on) {
      // skrytý úkol nesmí mít cizího řešitele (nikdo jiný ho nevidí)
      setAssignee(userId);
      setAssignToo(false);
    }
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

    // řešitelé: vybraný + případně čekaný člen („zadat mu to i jako úkol")
    const effAssignee = isPrivate ? userId : assignee;
    const assigneeIds = new Set<string>();
    if (effAssignee) assigneeIds.add(effAssignee);
    if (!isPrivate && assignToo && waitSel?.kind === "u") assigneeIds.add(waitSel.id);

    for (const uid of assigneeIds) {
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
    if (assigneeIds.size > 0) pingNotifyEmails();

    // follow-up: čekám na člena / kontakt (nový kontakt rovnou založ)
    if (canDelegate && waitSel) {
      let contactId: string | null = null;
      if (waitSel.kind === "new") {
        const { data: c, error: cError } = await supabase
          .from("contacts")
          .insert({ workspace_id: wsId, name: waitSel.name, created_by: userId })
          .select("id")
          .single();
        if (cError || !c) toast("Kontakt se nepodařilo založit.", "error");
        else contactId = c.id as string;
      } else if (waitSel.kind === "c") {
        contactId = waitSel.id;
      }
      if (waitSel.kind === "u" || contactId) {
        const { error: fuError } = await supabase.from("task_followups").insert({
          task_id: created.id,
          workspace_id: wsId,
          created_by: userId,
          waiting_user_id: waitSel.kind === "u" ? waitSel.id : null,
          waiting_contact_id: contactId,
        });
        if (fuError) toast("Follow-up se nepodařilo nastavit.", "error");
      }
    }

    setSaving(false);
    toast(`Úkol přidán: ${name}`);
    onCreated();
  }

  const showWaitSuggest = q.length > 0 && !waitSel;

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
          {canAssignOthers && !isPrivate ? (
            <Picker
              options={[
                { id: null, label: "Bez řešitele" },
                ...assignable.map((m) => ({
                  id: m.user_id as string | null,
                  label:
                    m.user_id === userId
                      ? `${memberName(m)} (já)`
                      : memberName(m),
                })),
              ]}
              value={assignee}
              onChange={setAssignee}
              placeholder="Řešitel"
              iconPath={USER_ICON}
              ariaLabel="Řešitel"
              align="left"
            />
          ) : (
            <span className="px-1 text-sm text-ink-soft">
              Řešitel: <span className="text-ink">{meName}</span>
            </span>
          )}
        </div>

        {/* follow-up: koho dodávku hlídám (nezávislé na řešiteli) */}
        {canDelegate && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-soft">⏳ Čekám na</span>
              {waitSel ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {waitSel.kind === "u" ? "👤" : waitSel.kind === "c" ? "👻" : "➕"}{" "}
                  {waitSel.name}
                  {waitSel.kind === "new" && " (nový kontakt)"}
                  <button
                    type="button"
                    onClick={() => {
                      setWaitSel(null);
                      setAssignToo(false);
                    }}
                    aria-label="Zrušit čekání"
                    className="ml-0.5 text-amber-800/60 hover:text-amber-900"
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <div className="relative min-w-44 flex-1">
                  <input
                    type="text"
                    value={waitQuery}
                    onChange={(e) => setWaitQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || !showWaitSuggest) return;
                      e.preventDefault();
                      if (memberHits[0])
                        pickWait({
                          kind: "u",
                          id: memberHits[0].user_id,
                          name: memberName(memberHits[0]),
                        });
                      else if (contactHits[0])
                        pickWait({
                          kind: "c",
                          id: contactHits[0].id,
                          name: contactHits[0].name,
                        });
                      else pickWait({ kind: "new", name: waitQuery.trim() });
                    }}
                    placeholder="Jméno člověka… (nepovinné)"
                    aria-label="Čekám na"
                    className="input w-full px-2 py-1 text-sm"
                  />
                  {showWaitSuggest && (
                    <ul
                      role="listbox"
                      aria-label="Čekat na"
                      className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg"
                    >
                      {memberHits.map((m) => (
                        <li key={m.user_id}>
                          <button
                            type="button"
                            onClick={() =>
                              pickWait({
                                kind: "u",
                                id: m.user_id,
                                name: memberName(m),
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent-soft"
                          >
                            👤 <span className="min-w-0 flex-1 truncate">{memberName(m)}</span>
                            <span className="text-xs text-ink-soft/60">člen</span>
                          </button>
                        </li>
                      ))}
                      {contactHits.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() =>
                              pickWait({ kind: "c", id: c.id, name: c.name })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent-soft"
                          >
                            👻 <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            <span className="text-xs text-ink-soft/60">kontakt</span>
                          </button>
                        </li>
                      ))}
                      {!exactHit && (
                        <li>
                          <button
                            type="button"
                            onClick={() =>
                              pickWait({ kind: "new", name: waitQuery.trim() })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-accent hover:bg-accent-soft"
                          >
                            ➕ založit kontakt „{waitQuery.trim()}"
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* čekaný člen zatím není řešitel → nabídni zadání */}
            {!isPrivate &&
              waitSel?.kind === "u" &&
              waitSel.id !== assignee && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    checked={assignToo}
                    onChange={(e) => setAssignToo(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  zadat mu to i jako úkol (uvidí ho a dostane upozornění)
                </label>
              )}

            {/* zkratka z druhé strany: řešitel je někdo jiný → pohlídat dodání */}
            {!waitSel && assignee && assignee !== userId && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={(e) => toggleFollowUpOnAssignee(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Follow-up — pohlídat dodání v Delegovaných
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
              title="Skrytý úkol vidíš jen ty — nikdo jiný, ani admin."
            >
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => togglePrivate(e.target.checked)}
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
