"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";

export default function ProjectsView({ wsId }: { wsId: string }) {
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", wsId)
      .order("archived")
      .order("name");
    setProjects((data as Project[]) ?? []);
    setLoading(false);
  }, [supabase, wsId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await supabase.from("projects").insert({ workspace_id: wsId, name: newName.trim() });
    setNewName("");
    load();
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

  if (loading) return <p className="p-4 text-neutral-400">Načítám…</p>;

  return (
    <div className="space-y-4">
      <form
        onSubmit={add}
        className="flex gap-2 rounded-xl border border-neutral-200 bg-white p-3"
      >
        <input
          type="text"
          placeholder="Nový projekt…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Přidat
        </button>
      </form>

      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
        {projects.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">Zatím žádné projekty.</p>
        )}
        {projects.map((project) => (
          <div key={project.id} className="flex items-center gap-2 px-3 py-2">
            {editingId === project.id ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  autoFocus
                />
                <button
                  onClick={() => rename(project)}
                  className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white"
                >
                  Uložit
                </button>
              </>
            ) : (
              <>
                <span
                  className={`flex-1 text-sm ${project.archived ? "text-neutral-400 line-through" : ""}`}
                >
                  {project.name}
                </span>
                <button
                  onClick={() => {
                    setEditingId(project.id);
                    setEditName(project.name);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                >
                  Přejmenovat
                </button>
                <button
                  onClick={() => toggleArchive(project)}
                  className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                >
                  {project.archived ? "Obnovit" : "Archivovat"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
