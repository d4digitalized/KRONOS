"use client";

import Picker from "@/components/Picker";
import type { Project } from "@/lib/types";

/* Projekty nemají vlastní barvu v DB — tečku odvozujeme stabilně z id,
   paleta ladí s petrolejovou/mosaznou kostrou design systému. */
const DOT_PALETTE = [
  "#0e7569", // petrolejová
  "#b45309", // mosaz
  "#0369a1", // modrá
  "#be185d", // malinová
  "#6d28d9", // fialová
  "#4d7c0f", // olivová
  "#b91c1c", // cihlová
  "#475569", // břidlice
];

export function projectColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return DOT_PALETTE[Math.abs(h) % DOT_PALETTE.length];
}

/** Tečka projektu; bez projektu (id null) = obrysová.
    print-color-adjust ať ji tisk/PDF nevybělí. */
export function ProjectDot({
  id,
  className = "h-2.5 w-2.5",
}: {
  id: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact] ${
        id ? "" : "border border-ink-soft/40"
      } ${className}`}
      style={id ? { background: projectColor(id) } : undefined}
      aria-hidden
    />
  );
}

const FOLDER_ICON =
  "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

export default function ProjectPicker({
  projects,
  value,
  onChange,
  align = "right",
  hideLabelOnMobile = false,
}: {
  projects: Project[];
  value: string | null;
  onChange: (projectId: string | null) => void;
  align?: "left" | "right";
  hideLabelOnMobile?: boolean;
}) {
  return (
    <Picker
      options={[
        { id: null, label: "Bez projektu", dot: null },
        ...projects.map((p) => ({
          id: p.id as string | null,
          label: p.name,
          dot: projectColor(p.id),
        })),
      ]}
      value={value}
      onChange={onChange}
      placeholder="Projekt"
      iconPath={FOLDER_ICON}
      ariaLabel="Projekt"
      align={align}
      hideLabelOnMobile={hideLabelOnMobile}
    />
  );
}
