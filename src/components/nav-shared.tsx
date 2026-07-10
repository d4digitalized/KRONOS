// Sdílená navigační konfigurace pro desktopový Sidebar i mobilní MobileNav.
// Jeden zdroj pravdy pro ikony i skladbu sekcí podle rolí.

export const ICONS = {
  board: "M4 5h7v14H4zM13 5h7v8h-7z",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  chart: "M5 20V10M12 20V4M19 20v-7",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.87M15.5 3.13a4 4 0 0 1 0 7.75",
  shield: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  collapse: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  expand: "M13 7l5 5-5 5M6 7l5 5-5 5",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M18 6L6 18M6 6l12 12",
  hourglass: "M7 3h10M7 21h10M8 3v4l4 5 4-5V3M8 21v-4l4-5 4 5v4",
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
} as const;

export type IconName = keyof typeof ICONS;

export function NavIcon({
  d,
  className = "h-[18px] w-[18px] shrink-0",
}: {
  d: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** true = vedle položky se ukazuje živé počítadlo Inboxu */
  badge?: boolean;
};
export type NavSection = { title: string; items: NavItem[] };

/** Kompletní sekce menu podle rolí (Sidebar / drawer). */
export function buildNavSections(
  wsId: string,
  isAdmin: boolean,
  isSuperAdmin: boolean,
  canDelegate = false,
  canTaskforce = false,
): NavSection[] {
  return [
    {
      title: "Sledování",
      items: [
        { href: `/w/${wsId}/inbox`, label: "Inbox", icon: "inbox", badge: true },
        { href: `/w/${wsId}/my`, label: "Moje úkoly", icon: "user" },
        // Čekám na — jen pro odemknuté delegátory (admin / can_delegate)
        ...(canDelegate
          ? [
              {
                href: `/w/${wsId}/delegated`,
                label: "Čekám na",
                icon: "hourglass" as const,
              },
            ]
          : []),
        { href: `/w/${wsId}`, label: "Projekty", icon: "board" },
        // Task force — úkoly skupiny; jen kdo může zadávat i jiným (admin / grant)
        ...(canTaskforce
          ? [
              {
                href: `/w/${wsId}/tasks`,
                label: "Task force",
                icon: "users" as const,
              },
            ]
          : []),
        { href: `/w/${wsId}/time`, label: "Report", icon: "clock" },
      ],
    },
    {
      title: "Analýza",
      items: [{ href: `/w/${wsId}/reports`, label: "Přehledy", icon: "chart" }],
    },
    ...(isAdmin
      ? [
          {
            title: "Správa",
            items: [
              {
                href: `/w/${wsId}/projects`,
                label: "Správa projektů",
                icon: "folder" as const,
              },
              { href: `/w/${wsId}/members`, label: "Členové", icon: "users" as const },
            ],
          },
        ]
      : []),
    ...(isSuperAdmin
      ? [
          {
            title: "Admin",
            items: [{ href: "/admin", label: "Administrace", icon: "shield" as const }],
          },
        ]
      : []),
  ];
}

/** Hlavní položky pro spodní tab-bar na mobilu. */
export function primaryNavItems(wsId: string, canTaskforce = false): NavItem[] {
  return [
    { href: `/w/${wsId}/my`, label: "Moje", icon: "user" },
    { href: `/w/${wsId}`, label: "Projekty", icon: "board" },
    ...(canTaskforce
      ? [
          {
            href: `/w/${wsId}/tasks`,
            label: "Task force",
            icon: "users" as const,
          },
        ]
      : []),
    { href: `/w/${wsId}/time`, label: "Report", icon: "clock" },
  ];
}

/** „Projekty" jsou aktivní i na nástěnce konkrétního projektu. */
export function isNavActive(pathname: string, href: string, wsId: string): boolean {
  return (
    pathname === href ||
    (href === `/w/${wsId}` && pathname.startsWith(`/w/${wsId}/b/`))
  );
}
