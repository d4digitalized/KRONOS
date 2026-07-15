"use client";

import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import Picker from "@/components/Picker";
import Avatar from "@/components/Avatar";
import type { Contact, Membership } from "@/lib/types";

/** Kolečko s iniciálami pro ducha (kontakt bez účtu). Bez vlastního
    nastavení šedé, ať se odliší od barevných avatarů skutečných členů;
    vlastní iniciály a barvu jde kontaktu nastavit v Členech. */
function GhostAvatar({ contact }: { contact: Contact }) {
  return (
    <Avatar
      profile={{
        full_name: contact.name,
        avatar_initials: contact.avatar_initials || null,
        avatar_color: contact.avatar_color || "#9ca3af",
      }}
      colorKey={contact.id}
      size="sm"
    />
  );
}

export const USER_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
export const HOURGLASS_ICON =
  "M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4";

/** Odkaz na člověka: "u:<userId>" (člen s účtem) | "c:<contactId>" (duch). */
export type PersonRef = string;

export function isMemberRef(ref: PersonRef): boolean {
  return ref.startsWith("u:");
}

export function personRefId(ref: PersonRef): string {
  return ref.slice(2);
}

/** Zobrazované jméno pro ref — člen z members, duch z contacts. */
export function personName(
  ref: PersonRef,
  members: Membership[],
  contacts: Contact[]
): string {
  const id = personRefId(ref);
  if (isMemberRef(ref)) {
    const m = members.find((x) => x.user_id === id);
    return m?.profiles?.full_name || m?.profiles?.email || "člen";
  }
  return contacts.find((c) => c.id === id)?.name ?? "duch";
}

/** Jednotný kombobox na lidi: členové 👤 → duchové 👻 → „➕ založit kontakt".
    Jeden vzhled i chování pro řešitele a follow-upy v dialogu, Inboxu,
    kartě i Task force. Zakládání kontaktů centralizované tady. */
export default function PersonPicker({
  wsId,
  userId,
  members,
  contacts,
  value,
  onChange,
  onContactCreated,
  includeMe = true,
  noneLabel,
  excludeRefs,
  allowGhosts = true,
  placeholder,
  ariaLabel,
  iconPath = USER_ICON,
  align = "left",
  hideLabelOnMobile = false,
}: {
  wsId: string;
  /** přihlášený uživatel — „(já)" v nabídce a created_by nových kontaktů */
  userId: string;
  members: Membership[];
  contacts: Contact[];
  value: PersonRef | null;
  onChange: (ref: PersonRef | null) => void;
  /** nový duch z „➕ založit" — parent si ho přidá do svého seznamu kontaktů */
  onContactCreated?: (contact: Contact) => void;
  includeMe?: boolean;
  /** přidá volbu s id null (např. „Bez řešitele" / „— nikdo —") */
  noneLabel?: string;
  /** refs, které se nemají nabízet (např. už přiřazení řešitelé) */
  excludeRefs?: Set<PersonRef>;
  allowGhosts?: boolean;
  placeholder: string;
  ariaLabel: string;
  iconPath?: string;
  align?: "left" | "right";
  hideLabelOnMobile?: boolean;
}) {
  const supabase = createClient();
  const excluded = excludeRefs ?? new Set<PersonRef>();

  const options = [
    ...(noneLabel ? [{ id: null as string | null, label: noneLabel }] : []),
    ...members
      .filter((m) => includeMe || m.user_id !== userId)
      .filter((m) => !excluded.has(`u:${m.user_id}`))
      // „(já)" vždy jako první možnost, ostatní podle abecedy
      .sort((a, b) => {
        if (a.user_id === userId) return -1;
        if (b.user_id === userId) return 1;
        return (a.profiles?.full_name || a.profiles?.email || "").localeCompare(
          b.profiles?.full_name || b.profiles?.email || "",
          "cs"
        );
      })
      .map((m) => {
        const name = m.profiles?.full_name || m.profiles?.email || "?";
        return {
          id: `u:${m.user_id}` as string | null,
          label: m.user_id === userId ? `${name} (já)` : name,
          avatar: (
            <Avatar profile={m.profiles} colorKey={m.user_id} size="sm" />
          ),
        };
      }),
    ...(allowGhosts
      ? contacts
          .filter((c) => !excluded.has(`c:${c.id}`))
          .map((c) => ({
            id: `c:${c.id}` as string | null,
            label: c.name,
            avatar: <GhostAvatar contact={c} />,
            // duchové se v nabídce ukážou až po zadání prvního znaku
            deferred: true,
          }))
      : []),
  ];

  async function createContact(name: string) {
    const { data, error } = await supabase
      .from("contacts")
      .insert({ workspace_id: wsId, name, created_by: userId })
      .select("id")
      .single();
    if (error || !data) {
      toast("Kontakt se nepodařilo založit.", "error");
      return;
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
    onContactCreated?.(contact);
    onChange(`c:${contact.id}`);
  }

  return (
    <Picker
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      iconPath={iconPath}
      ariaLabel={ariaLabel}
      align={align}
      hideLabelOnMobile={hideLabelOnMobile}
      alwaysSearch
      onCreate={allowGhosts ? createContact : undefined}
      createLabel="založit kontakt"
    />
  );
}
