"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { posBetween } from "@/lib/position";
import { toast } from "@/lib/toast";
import { pingNotifyEmails } from "@/lib/notify";
import { PRIORITIES } from "@/lib/priority";
import ProjectPicker from "@/components/ProjectPicker";
import Picker from "@/components/Picker";
import type { Membership, Project } from "@/lib/types";

const USER_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";

/** Rychlé založení úkolu. Řešitel je předvyplněný na mě; koho smím přiřadit
    navíc, řeší role (admin) a granty — stejná pravidla jako v kartě. */
export default function NewTaskDialog({
  wsId,
  userId,
  onClose,
  onCreated,
}: {
  wsId: string;
  userId: string;
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
          "user_id, role, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
        .eq("workspace_id", wsId),
      supabase
        .from("assign_grants")
        .select("target_id")
        .eq("workspace_id", wsId)
        .eq("user_id", userId),
    ]).then(([projRes, memRes, grantRes]) => {
      const list = (projRes.data as Project[]) ?? [];
      setProjects(list);
      if (list.length === 1) setProjectId(list[0].id); // jediný projekt předvyber
      setMembers((memRes.data as unknown as Membership[]) ?? []);
      setGrants(new Set((grantRes.data ?? []).map((r) => r.target_id as string)));
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
  // (a to jen z členů projektu — jinak by úkol kvůli RLS neviděli)
  const candidates = isAdmin
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    if (!projectId) {
      toast("Vyber projekt úkolu.", "error");
      return;
    }
    setSaving(true);

    // úkol jde na konec prvního sloupce nástěnky projektu
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

    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        workspace_id: wsId,
        project_id: projectId,
        column_id: col?.id ?? null,
        title: name,
        due_date: dueDate || null,
        priority,
        position: posBetween(last?.position, undefined),
      })
      .select("id")
      .single();

    if (error || !created) {
      setSaving(false);
      toast("Úkol se nepodařilo přidat.", "error");
      return;
    }

    if (assignee) {
      // řešitel musí být člen projektu (RLS) — admin nečlena rovnou doplní
      if (isAdmin && !projectMembers.has(assignee)) {
        await supabase
          .from("project_members")
          .upsert(
            { project_id: projectId, user_id: assignee },
            { onConflict: "project_id,user_id", ignoreDuplicates: true }
          );
      }
      const { error: taError } = await supabase
        .from("task_assignees")
        .insert({ task_id: created.id, user_id: assignee });
      if (taError) toast("Řešitele se nepodařilo přiřadit.", "error");
      else pingNotifyEmails();
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
          {canAssignOthers ? (
            <Picker
              options={[
                { id: null, label: "Bez řešitele" },
                ...assignable.map((m) => ({
                  id: m.user_id as string | null,
                  label:
                    m.user_id === userId
                      ? `${m.profiles?.full_name || m.profiles?.email} (já)`
                      : m.profiles?.full_name || m.profiles?.email || "?",
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
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Zrušit
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || !projectId}
            className="btn-primary"
          >
            {saving ? "Ukládám…" : "Přidat úkol"}
          </button>
        </div>
      </form>
    </div>
  );
}
