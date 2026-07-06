"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { ProjectDot } from "@/components/ProjectPicker";
import type { Membership, Project } from "@/lib/types";

export default function ProjectsView({ wsId }: { wsId: string }) {
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [wsMembers, setWsMembers] = useState<Membership[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);
  // rozbalená správa členů projektu
  const [membersFor, setMembersFor] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [assignedLoading, setAssignedLoading] = useState(false);

  const load = useCallback(async () => {
    const [projectsRes, membersRes] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("workspace_id", wsId)
        .order("archived")
        .order("position")
        .order("name"),
      supabase
        .from("workspace_members")
        .select("workspace_id, user_id, role, profiles(full_name, email)")
        .eq("workspace_id", wsId),
    ]);
    setProjects((projectsRes.data as Project[]) ?? []);
    const members = (membersRes.data as unknown as Membership[]) ?? [];
    members.sort((a, b) =>
      (a.profiles?.full_name || a.profiles?.email || "").localeCompare(
        b.profiles?.full_name || b.profiles?.email || "",
        "cs"
      )
    );
    setWsMembers(members);
    setLoading(false);
  }, [supabase, wsId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await supabase.from("projects").insert({
      workspace_id: wsId,
      name: newName.trim(),
      position: Math.max(0, ...projects.map((p) => p.position)) + 1,
    });
    setNewName("");
    load();
  }

  /** Posun v rámci stejné skupiny (aktivní/archivované): prohodí position. */
  async function move(project: Project, dir: -1 | 1) {
    const group = projects.filter((p) => p.archived === project.archived);
    const idx = group.findIndex((p) => p.id === project.id);
    const other = group[idx + dir];
    if (!other) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === project.id
          ? { ...p, position: other.position }
          : p.id === other.id
            ? { ...p, position: project.position }
            : p
      ).sort((a, b) =>
        Number(a.archived) - Number(b.archived) ||
        a.position - b.position ||
        a.name.localeCompare(b.name, "cs")
      )
    );
    const [r1, r2] = await Promise.all([
      supabase.from("projects").update({ position: other.position }).eq("id", project.id),
      supabase.from("projects").update({ position: project.position }).eq("id", other.id),
    ]);
    if (r1.error || r2.error) {
      toast("Změna pořadí se nezdařila.", "error");
      load();
    }
  }

  async function rename(project: Project) {
    if (editName.trim() && editName.trim() !== project.name) {
      await supabase.from("projects").update({ name: editName.trim() }).eq("id", project.id);
    }
    setEditingId(null);
    load();
  }

  async function toggleArchive(project: Project) {
    await supabase
      .from("projects")
      .update({ archived: !project.archived })
      .eq("id", project.id);
    load();
  }

  async function openMembers(project: Project) {
    if (membersFor === project.id) {
      setMembersFor(null);
      return;
    }
    setMembersFor(project.id);
    setAssignedLoading(true);
    const { data } = await supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", project.id);
    setAssigned(new Set((data ?? []).map((r) => r.user_id as string)));
    setAssignedLoading(false);
  }

  async function toggleMember(projectId: string, userId: string) {
    const wasOn = assigned.has(userId);
    setAssigned((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(userId);
      else next.add(userId);
      return next;
    });
    const { error } = wasOn
      ? await supabase
          .from("project_members")
          .delete()
          .eq("project_id", projectId)
          .eq("user_id", userId)
      : await supabase
          .from("project_members")
          .insert({ project_id: projectId, user_id: userId });
    if (error) {
      setAssigned((prev) => {
        const next = new Set(prev);
        if (wasOn) next.add(userId);
        else next.delete(userId);
        return next;
      });
      toast("Změna členství se nezdařila.", "error");
    }
  }

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  return (
    <div className="space-y-4">
      <form
        onSubmit={add}
        className="flex gap-2 panel p-3"
      >
        <input
          type="text"
          placeholder="Nový projekt…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 input"
        />
        <button
          type="submit"
          className="btn-primary"
        >
          Přidat
        </button>
      </form>

      <div className="divide-y divide-line/70 panel">
        {projects.length === 0 && (
          <p className="p-4 text-sm text-ink-soft/70">Zatím žádné projekty.</p>
        )}
        {projects.map((project) => (
          <div key={project.id}>
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="flex flex-col">
                <button
                  onClick={() => move(project, -1)}
                  aria-label={`Posunout ${project.name} nahoru`}
                  className="rounded px-1 text-[10px] leading-3 text-ink-soft/50 hover:bg-black/5 hover:text-ink"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(project, 1)}
                  aria-label={`Posunout ${project.name} dolů`}
                  className="rounded px-1 text-[10px] leading-3 text-ink-soft/50 hover:bg-black/5 hover:text-ink"
                >
                  ▼
                </button>
              </span>
              <ProjectDot id={project.id} />
              {editingId === project.id ? (
                <>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 input px-2 py-1"
                    autoFocus
                  />
                  <button
                    onClick={() => rename(project)}
                    className="btn-primary px-2 py-1 text-xs"
                  >
                    Uložit
                  </button>
                </>
              ) : (
                <>
                  <span
                    className={`flex-1 text-sm ${project.archived ? "text-ink-soft/70 line-through" : ""}`}
                  >
                    {project.name}
                  </span>
                  <button
                    onClick={() => openMembers(project)}
                    aria-expanded={membersFor === project.id}
                    className={`rounded-md px-2 py-1 text-xs hover:bg-black/5 ${
                      membersFor === project.id
                        ? "bg-accent-soft text-accent"
                        : "text-ink-soft"
                    }`}
                  >
                    Členové
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(project.id);
                      setEditName(project.name);
                    }}
                    className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-black/5"
                  >
                    Přejmenovat
                  </button>
                  <button
                    onClick={() => toggleArchive(project)}
                    className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-black/5"
                  >
                    {project.archived ? "Obnovit" : "Archivovat"}
                  </button>
                </>
              )}
            </div>
            {membersFor === project.id && (
              <div className="border-t border-line/50 bg-black/[.015] px-3 py-2">
                <p className="pb-1 text-xs text-ink-soft/70">
                  Kdo projekt vidí a pracuje na něm. Admini vidí všechny projekty
                  automaticky.
                </p>
                {assignedLoading ? (
                  <p className="py-1 text-sm text-ink-soft/70">Načítám…</p>
                ) : (
                  <div className="grid gap-x-6 sm:grid-cols-2">
                    {wsMembers.map((member) => {
                      const name =
                        member.profiles?.full_name || member.profiles?.email || "?";
                      if (member.role === "admin") {
                        return (
                          <div
                            key={member.user_id}
                            className="flex items-center gap-2 py-1 text-sm text-ink-soft"
                          >
                            <span className="inline-flex h-4 w-4 items-center justify-center">
                              ✓
                            </span>
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            <span className="chip">admin · vidí vše</span>
                          </div>
                        );
                      }
                      return (
                        <label
                          key={member.user_id}
                          className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={assigned.has(member.user_id)}
                            onChange={() => toggleMember(project.id, member.user_id)}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
