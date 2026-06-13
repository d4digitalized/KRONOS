"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { inviteMember, listAddablePortalUsers } from "@/app/actions/members";
import Picker from "@/components/Picker";
import type { Membership, Role } from "@/lib/types";

const USER_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";

type PortalUser = { id: string; email: string; full_name: string };

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
  const [mode, setMode] = useState<"portal" | "email">("portal");
  const [email, setEmail] = useState("");
  const [pickedUserId, setPickedUserId] = useState<string | null>(null);
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [role, setRole] = useState<Role>("member");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const [{ data }, addable] = await Promise.all([
      supabase
        .from("workspace_members")
        .select("user_id, role, profiles(id, email, full_name, is_super_admin)")
        .eq("workspace_id", wsId)
        .order("role"),
      listAddablePortalUsers(wsId),
    ]);
    setMembers((data as unknown as Membership[]) ?? []);
    setPortalUsers(addable.users ?? []);
    setLoading(false);
  }, [supabase, wsId]);

  useEffect(() => {
    load();
  }, [load]);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const targetEmail =
      mode === "portal"
        ? portalUsers.find((u) => u.id === pickedUserId)?.email
        : email;
    if (!targetEmail) {
      setMessage(mode === "portal" ? "Vyber uživatele." : "Zadej e-mail.");
      return;
    }
    startTransition(async () => {
      const result = await inviteMember(wsId, targetEmail, role);
      setMessage(
        result.error ??
          (result.invited
            ? `Pozvánka odeslána na ${targetEmail.trim()}. Po nastavení hesla se tu objeví.`
            : "Člen přidán.")
      );
      if (result.ok) {
        setEmail("");
        setPickedUserId(null);
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

  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="space-y-3 panel p-3">
        <div className="inline-flex rounded-lg bg-black/5 p-0.5 text-sm">
          {(
            [
              ["portal", "Z portálu"],
              ["email", "E-mailem"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMode(key);
                setMessage(null);
              }}
              className={`rounded-md px-3 py-1 transition-colors ${
                mode === key
                  ? "bg-surface font-medium text-ink shadow-sm"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === "portal" ? (
            <div className="min-w-48 flex-1">
              <Picker
                options={portalUsers.map((u) => ({
                  id: u.id as string | null,
                  label: u.full_name || u.email,
                }))}
                value={pickedUserId}
                onChange={setPickedUserId}
                placeholder={
                  portalUsers.length ? "Vyber uživatele" : "Žádní volní uživatelé"
                }
                iconPath={USER_ICON}
                ariaLabel="Uživatel z portálu"
                align="left"
                disabled={portalUsers.length === 0}
              />
            </div>
          ) : (
            <input
              type="email"
              required
              placeholder="email@firma.cz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-48 flex-1 input"
            />
          )}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            aria-label="Role"
            className="input px-2"
          >
            <option value="member">Member</option>
            {isSuperAdmin && <option value="admin">Admin</option>}
          </select>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Přidávám…" : mode === "portal" ? "Přidat" : "Pozvat"}
          </button>
        </div>
        {message && <p className="text-sm text-ink-soft">{message}</p>}
      </form>

      <div className="divide-y divide-line/70 panel">
        {members.map((member) => (
          <div key={member.user_id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {member.profiles?.full_name || member.profiles?.email}
                {member.user_id === currentUserId && (
                  <span className="text-ink-soft/70"> (ty)</span>
                )}
              </p>
              <p className="truncate text-xs text-ink-soft/70">{member.profiles?.email}</p>
            </div>
            {isSuperAdmin ? (
              <select
                value={member.role}
                onChange={(e) => changeRole(member, e.target.value as Role)}
                className="input px-2 py-1 text-xs"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            ) : (
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  member.role === "admin"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-black/5 text-ink-soft"
                }`}
              >
                {member.role}
              </span>
            )}
            <button
              onClick={() => remove(member)}
              className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10"
            >
              Odebrat
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
