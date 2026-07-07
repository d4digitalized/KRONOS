"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  inviteMember,
  listAddablePortalUsers,
  listAllUsers,
  type AppUser,
} from "@/app/actions/members";
import Picker from "@/components/Picker";
import Avatar, { avatarInitials } from "@/components/Avatar";
import { toast } from "@/lib/toast";
import type { Membership, Role } from "@/lib/types";

/* stejná paleta jako tečky projektů — nabídka pro barvu avataru */
const AVATAR_COLORS = [
  "#0e7569",
  "#b45309",
  "#0369a1",
  "#be185d",
  "#6d28d9",
  "#4d7c0f",
  "#b91c1c",
  "#475569",
];

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
  // přepínač seznamu: členové této firmy × všichni uživatelé aplikace (jen super-admin)
  const [tab, setTab] = useState<"workspace" | "all">("workspace");
  const [allUsers, setAllUsers] = useState<AppUser[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  // admin editace profilu člena (jméno, iniciály, barva)
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eInitials, setEInitials] = useState("");
  const [eColor, setEColor] = useState("");
  const [eTag, setETag] = useState("");

  const load = useCallback(async () => {
    const [{ data }, addable] = await Promise.all([
      supabase
        .from("workspace_members")
        .select(
          "user_id, role, profiles(id, email, full_name, is_super_admin, avatar_initials, avatar_color, tag_name)"
        )
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

  const loadAll = useCallback(async () => {
    setAllLoading(true);
    setAllError(null);
    const result = await listAllUsers();
    if (result.error) setAllError(result.error);
    else setAllUsers(result.users ?? []);
    setAllLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "all" && allUsers === null && !allLoading) loadAll();
  }, [tab, allUsers, allLoading, loadAll]);

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

  function startEdit(member: Membership) {
    setEditId(member.user_id);
    setEName(member.profiles?.full_name ?? "");
    setEInitials(member.profiles?.avatar_initials ?? "");
    setEColor(member.profiles?.avatar_color ?? "");
    setETag(member.profiles?.tag_name ?? "");
  }

  async function saveEdit(member: Membership) {
    // tag: bez zavináče, malými písmeny; povolena písmena/číslice/._
    const tag = eTag.trim().replace(/^@/, "").toLowerCase();
    if (tag && !/^[a-z0-9_.]{2,30}$/.test(tag)) {
      toast("Tag smí mít 2–30 znaků: písmena, číslice, tečka, podtržítko.", "error");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: eName.trim(),
        avatar_initials: eInitials.trim().toUpperCase().slice(0, 3),
        avatar_color: eColor,
        tag_name: tag,
      })
      .eq("id", member.user_id);
    if (error) {
      toast(
        error.code === "23505"
          ? `Tag @${tag} už používá někdo jiný.`
          : "Uložení profilu se nezdařilo.",
        "error"
      );
      return;
    }
    setEditId(null);
    toast("Profil uložen.");
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

      {isSuperAdmin && (
        <div className="inline-flex rounded-lg bg-black/5 p-0.5 text-sm">
          {(
            [
              ["workspace", "Tato firma"],
              ["all", "Všichni uživatelé"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1 transition-colors ${
                tab === key
                  ? "bg-surface font-medium text-ink shadow-sm"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "all" && isSuperAdmin ? (
        <AllUsersPanel
          users={allUsers}
          loading={allLoading}
          error={allError}
          currentUserId={currentUserId}
        />
      ) : (
      <div className="divide-y divide-line/70 panel">
        {members.map((member) => (
          <div key={member.user_id}>
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar
                profile={member.profiles}
                colorKey={member.user_id}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {member.profiles?.full_name || member.profiles?.email}
                  {member.profiles?.tag_name && (
                    <span className="ml-1.5 text-xs text-accent">
                      @{member.profiles.tag_name}
                    </span>
                  )}
                  {member.user_id === currentUserId && (
                    <span className="text-ink-soft/70"> (ty)</span>
                  )}
                </p>
                <p className="truncate text-xs text-ink-soft/70">{member.profiles?.email}</p>
              </div>
              <button
                onClick={() =>
                  editId === member.user_id ? setEditId(null) : startEdit(member)
                }
                aria-expanded={editId === member.user_id}
                className={`rounded-md px-2 py-1 text-xs hover:bg-black/5 ${
                  editId === member.user_id
                    ? "bg-accent-soft text-accent"
                    : "text-ink-soft"
                }`}
              >
                Upravit
              </button>
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

            {editId === member.user_id && (
              <div className="space-y-2 border-t border-line/50 bg-black/[.015] px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar
                    profile={{
                      full_name: eName,
                      email: member.profiles?.email,
                      avatar_initials: eInitials,
                      avatar_color: eColor,
                    }}
                    colorKey={member.user_id}
                    size="lg"
                  />
                  <input
                    type="text"
                    value={eName}
                    onChange={(e) => setEName(e.target.value)}
                    placeholder="Jméno a příjmení"
                    aria-label="Jméno a příjmení"
                    className="input min-w-44 flex-1"
                  />
                  <input
                    type="text"
                    value={eInitials}
                    onChange={(e) => setEInitials(e.target.value)}
                    maxLength={3}
                    placeholder={avatarInitials({
                      full_name: eName,
                      email: member.profiles?.email,
                    })}
                    aria-label="Iniciály (max 3 znaky)"
                    title="Iniciály — prázdné se odvodí ze jména"
                    className="input w-16 text-center uppercase"
                  />
                  <span className="inline-flex items-center gap-0.5">
                    <span className="text-sm text-ink-soft/70">@</span>
                    <input
                      type="text"
                      value={eTag}
                      onChange={(e) => setETag(e.target.value)}
                      maxLength={30}
                      placeholder="tag"
                      aria-label="Tag name (bez zavináče)"
                      title="Unikátní tag, např. kostikova"
                      className="input w-32 lowercase"
                    />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-soft/70">Barva:</span>
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setEColor(color)}
                      aria-label={`Barva ${color}`}
                      aria-pressed={eColor === color}
                      style={{ background: color }}
                      className={`h-6 w-6 rounded-full transition-transform ${
                        eColor === color
                          ? "scale-110 ring-2 ring-ink ring-offset-1"
                          : "hover:scale-105"
                      }`}
                    />
                  ))}
                  <input
                    type="color"
                    value={eColor || "#0e7569"}
                    onChange={(e) => setEColor(e.target.value)}
                    aria-label="Vlastní barva"
                    title="Vlastní barva"
                    className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent"
                  />
                  {eColor && (
                    <button
                      onClick={() => setEColor("")}
                      className="btn-ghost px-2 py-0.5 text-xs"
                    >
                      Automatická
                    </button>
                  )}
                  <span className="flex-1" />
                  <button
                    onClick={() => setEditId(null)}
                    className="btn-ghost px-2 py-1 text-xs"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={() => saveEdit(member)}
                    className="btn-primary px-3 py-1 text-xs"
                  >
                    Uložit
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function AllUsersPanel({
  users,
  loading,
  error,
  currentUserId,
}: {
  users: AppUser[] | null;
  loading: boolean;
  error: string | null;
  currentUserId: string;
}) {
  if (loading) return <p className="p-4 text-ink-soft/70">Načítám…</p>;
  if (error) return <p className="p-4 text-sm text-danger">{error}</p>;
  if (!users?.length)
    return <p className="p-4 text-ink-soft/70">Žádní uživatelé.</p>;

  return (
    <div className="divide-y divide-line/70 panel">
      {users.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-3 py-2">
          <Avatar profile={u} colorKey={u.id} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {u.full_name || u.email}
              {u.tag_name && (
                <span className="ml-1.5 text-xs text-accent">@{u.tag_name}</span>
              )}
              {u.id === currentUserId && (
                <span className="text-ink-soft/70"> (ty)</span>
              )}
              {u.is_super_admin && (
                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  super-admin
                </span>
              )}
              {u.status === "pending" && (
                <span
                  className="ml-1.5 rounded bg-black/5 px-1.5 py-0.5 text-xs text-ink-soft"
                  title="Pozván, ale ještě si nenastavil heslo"
                >
                  čeká na aktivaci
                </span>
              )}
            </p>
            <p className="truncate text-xs text-ink-soft/70">{u.email}</p>
            {u.memberships.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {u.memberships.map((m) => (
                  <span
                    key={m.workspaceId}
                    className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 text-xs text-ink-soft"
                  >
                    {m.workspaceName}
                    <span
                      className={
                        m.role === "admin" ? "text-amber-700" : "text-ink-soft/60"
                      }
                    >
                      · {m.role}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-ink-soft/50">V žádné firmě</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
