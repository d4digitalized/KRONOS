"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Workspace } from "@/lib/types";

export default function WorkspacesAdmin() {
  const supabase = createClient();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from("workspaces").select("*").order("name");
    setWorkspaces((data as Workspace[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await supabase.from("workspaces").insert({ name: newName.trim() });
    setNewName("");
    load();
  }

  async function rename(ws: Workspace) {
    if (editName.trim() && editName.trim() !== ws.name) {
      await supabase.from("workspaces").update({ name: editName.trim() }).eq("id", ws.id);
    }
    setEditingId(null);
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
          placeholder="Název nové firmy / workspace…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Založit
        </button>
      </form>

      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
        {workspaces.length === 0 && (
          <p className="p-4 text-sm text-neutral-400">Zatím žádné workspaces.</p>
        )}
        {workspaces.map((ws) => (
          <div key={ws.id} className="flex items-center gap-2 px-3 py-2">
            {editingId === ws.id ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  autoFocus
                />
                <button
                  onClick={() => rename(ws)}
                  className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white"
                >
                  Uložit
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm font-medium">{ws.name}</span>
                <Link
                  href={`/w/${ws.id}`}
                  className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                >
                  Otevřít
                </Link>
                <Link
                  href={`/w/${ws.id}/members`}
                  className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                >
                  Členové
                </Link>
                <button
                  onClick={() => {
                    setEditingId(ws.id);
                    setEditName(ws.name);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                >
                  Přejmenovat
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
