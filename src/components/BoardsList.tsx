"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProjectDot } from "@/components/ProjectPicker";
import type { Project } from "@/lib/types";

export default function BoardsList({
  wsId,
  isAdmin,
}: {
  wsId: string;
  isAdmin: boolean;
}) {
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", wsId)
      .eq("archived", false)
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

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <form
          onSubmit={add}
          className="flex gap-2 panel p-3"
        >
          <input
            type="text"
            placeholder="Nová nástěnka (projekt)…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 input"
          />
          <button
            type="submit"
            className="btn-primary"
          >
            Založit
          </button>
        </form>
      )}

      {projects.length === 0 ? (
        <p className="p-4 text-sm text-ink-soft/70">
          {isAdmin
            ? "Žádné nástěnky. Založ první nahoře."
            : "Žádné nástěnky. Požádej admina o přidání na projekt."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/w/${wsId}/b/${project.id}`}
              className="flex items-center gap-2.5 panel p-4 font-medium shadow-sm hover:border-accent/50"
            >
              <ProjectDot id={project.id} />
              <span className="truncate">{project.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
