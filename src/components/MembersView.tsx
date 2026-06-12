"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { inviteMember } from "@/app/actions/members";
import type { Membership, Role } from "@/lib/types";

export default function MembersView({
  wsId,
  currentUserId,
  isSuperAdmin,
}: {
  wsId: string;
  currentUserId: string;
  isSuperAdmin: boolean;
}) {
  const supabase = createClient();
  const [members, setMembers] = useState<Membership[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("workspace_members")
      .select("user_id, role, profiles(id, email, full_name, is_super_admin)")
      .eq("workspace_id", wsId)
      .order("role");
    setMembers((data as unknown as Membership[]) ?? []);
    setLoading(false);
  }, [supabase, wsId]);

  useEffect(() => {
    load();
  }, [load]);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await inviteMember(wsId, email, role);
      setMessage(result.error ?? "Pozvánka odeslána / člen přidán.");
      if (result.ok) {
        setEmail("");
        load();
      }
    });
  }

  async function changeRole(member: Membership, newRole: Role) {
    const { error } = await supabase
      .from("workspace_members")
      .update({ role: newRole })
      .eq("workspace_id", wsId)
      .eq("user_id", member.user_id);
    if (error) setMessage("Roli může měnit jen super-admin.");
    load();
  }

  async function remove(member: Membership) {
    const name = member.profiles?.full_name || member.profiles?.email;
    if (!confirm(`Odebrat ${name} z workspace?`)) return;
    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", wsId)
      .eq("user_id", member.user_id);
    if (error) setMessage("Odebrání se nezdařilo (admina odebírá jen super-admin).");
    load();
  }

  if (loading) return <p className="p-4 text-neutral-400">Načítám…</p>;

  return (
    <div className="space-y-4">
      <form
        onSubmit={invite}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3"
      >
        <input
          type="email"
          required
          placeholder="email@firma.cz"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-w-48 flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="member">Member</option>
          {isSuperAdmin && <option value="admin">Admin</option>}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? "Posílám…" : "Pozvat"}
        </button>
        {message && <p className="w-full text-sm text-neutral-600">{message}</p>}
      </form>

      <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
        {members.map((member) => (
          <div key={member.user_id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {member.profiles?.full_name || member.profiles?.email}
                {member.user_id === currentUserId && (
                  <span className="text-neutral-400"> (ty)</span>
                )}
              </p>
              <p className="truncate text-xs text-neutral-400">{member.profiles?.email}</p>
            </div>
            {isSuperAdmin ? (
              <select
                value={member.role}
                onChange={(e) => changeRole(member, e.target.value as Role)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            ) : (
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  member.role === "admin"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {member.role}
              </span>
            )}
            <button
              onClick={() => remove(member)}
              className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Odebrat
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
