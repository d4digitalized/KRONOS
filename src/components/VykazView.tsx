"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entrySeconds, fmtDuration, fmtTime } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

type Props = {
  wsId: string;
  userId: string;
  from: string;
  to: string;
  rate: number | null;
  unit: "hod" | "mesic";
};

const CZK = new Intl.NumberFormat("cs-CZ", {
  style: "currency",
  currency: "CZK",
  maximumFractionDigits: 0,
});

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/** „Červen 2026" pro celý kalendářní měsíc, jinak „1. 6. 2026 – 15. 6. 2026" */
function periodLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00`);
  const t = new Date(`${to}T00:00`);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  if (
    f.getDate() === 1 &&
    t.getDate() === lastDay &&
    f.getMonth() === t.getMonth() &&
    f.getFullYear() === t.getFullYear()
  ) {
    const month = f.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });
    return month.charAt(0).toUpperCase() + month.slice(1);
  }
  return `${f.toLocaleDateString("cs-CZ")} – ${t.toLocaleDateString("cs-CZ")}`;
}

export default function VykazView({ wsId, userId, from, to, rate, unit }: Props) {
  const supabase = createClient();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [person, setPerson] = useState<{ full_name: string; email: string } | null>(null);
  const [wsName, setWsName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const toExclusive = new Date(`${to}T00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);
    const [entriesRes, profileRes, wsRes] = await Promise.all([
      supabase
        .from("time_entries")
        .select("id, started_at, stopped_at, description, project_id, projects(name), tasks(title)")
        .eq("workspace_id", wsId)
        .eq("user_id", userId)
        .not("stopped_at", "is", null)
        .gte("started_at", new Date(`${from}T00:00`).toISOString())
        .lt("started_at", toExclusive.toISOString())
        .order("started_at", { ascending: true }),
      supabase.from("profiles").select("full_name, email").eq("id", userId).single(),
      supabase.from("workspaces").select("name").eq("id", wsId).single(),
    ]);
    setEntries((entriesRes.data as unknown as TimeEntry[]) ?? []);
    setPerson(profileRes.data ?? null);
    setWsName(wsRes.data?.name ?? "");
    setLoading(false);
  }, [supabase, wsId, userId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="p-8 text-ink-soft/70">Připravuji výkaz…</p>;
  }

  const totalSeconds = entries.reduce(
    (sum, e) => sum + entrySeconds(e.started_at, e.stopped_at),
    0
  );
  const totalHours = totalSeconds / 3600;

  const byProject = new Map<string, number>();
  for (const entry of entries) {
    const name = entry.projects?.name ?? "Bez projektu";
    byProject.set(name, (byProject.get(name) ?? 0) + entrySeconds(entry.started_at, entry.stopped_at));
  }

  const amount = rate === null ? null : unit === "hod" ? rate * totalHours : rate;
  const personName = person?.full_name || person?.email || "?";

  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <div className="mx-auto flex max-w-[210mm] items-center justify-between px-8 pt-6 print:hidden">
        <p className="text-sm text-ink-soft">
          Náhled výkazu — PDF uložíš tlačítkem vpravo (cíl „Uložit jako PDF“).
        </p>
        <button onClick={() => window.print()} className="btn-primary">
          Uložit jako PDF
        </button>
      </div>

      <div className="mx-auto my-6 max-w-[210mm] bg-white p-10 shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-baseline justify-between border-b-2 border-ink pb-3">
          <h1 className="font-display text-2xl font-semibold">Pracovní výkaz</h1>
          <span className="text-lg">{periodLabel(from, to)}</span>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-ink-soft">Pracovník</dt>
          <dd className="font-medium">
            {personName}
            {person?.full_name && person?.email ? (
              <span className="font-normal text-ink-soft"> · {person.email}</span>
            ) : null}
          </dd>
          <dt className="text-ink-soft">Workspace</dt>
          <dd>{wsName}</dd>
          <dt className="text-ink-soft">Období</dt>
          <dd>
            {fmtDay(`${from}T00:00`)} – {fmtDay(`${to}T00:00`)}
          </dd>
          <dt className="text-ink-soft">Vystaveno</dt>
          <dd>{new Date().toLocaleDateString("cs-CZ")}</dd>
        </dl>

        {entries.length === 0 ? (
          <p className="mt-8 text-sm text-ink-soft">
            Za zvolené období nejsou žádné dokončené záznamy času.
          </p>
        ) : (
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="py-1.5 pr-3 font-medium">Datum</th>
                <th className="py-1.5 pr-3 font-medium">Projekt</th>
                <th className="py-1.5 pr-3 font-medium">Popis</th>
                <th className="py-1.5 pr-3 font-medium">Od–Do</th>
                <th className="py-1.5 text-right font-medium">Hodiny</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line/70">
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    {fmtDay(entry.started_at)}
                  </td>
                  <td className="py-1.5 pr-3">{entry.projects?.name ?? "Bez projektu"}</td>
                  <td className="py-1.5 pr-3">
                    {entry.tasks?.title || entry.description || "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-ink-soft">
                    {fmtTime(entry.started_at)} – {entry.stopped_at ? fmtTime(entry.stopped_at) : ""}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmtDuration(entrySeconds(entry.started_at, entry.stopped_at))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink font-medium">
                <td colSpan={4} className="py-2 pr-3">
                  Celkem
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {fmtDuration(totalSeconds)} h
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {byProject.size > 1 && (
          <section className="mt-6">
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
              Souhrn po projektech
            </h2>
            <table className="mt-1 w-auto min-w-64 text-sm">
              <tbody>
                {[...byProject.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, seconds]) => (
                    <tr key={name} className="border-b border-line/50 last:border-0">
                      <td className="py-1 pr-8">{name}</td>
                      <td className="py-1 text-right font-mono tabular-nums">
                        {fmtDuration(seconds)} h
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="mt-6 border-t border-line pt-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <span className="text-ink-soft">Odpracováno celkem</span>
            <span className="font-medium">
              {fmtDuration(totalSeconds)} h (
              {totalHours.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} h)
            </span>
            {rate !== null && (
              <>
                <span className="text-ink-soft">
                  {unit === "hod" ? "Hodinová sazba" : "Měsíční sazba"}
                </span>
                <span>
                  {CZK.format(rate)}
                  {unit === "hod" ? " / hod" : " / měsíc"}
                </span>
                <span className="text-ink-soft">Odměna za období</span>
                <span className="font-semibold">{CZK.format(amount!)}</span>
              </>
            )}
          </div>
        </section>

        <section className="mt-16 grid grid-cols-2 gap-16 text-sm">
          {["Vypracoval(a)", "Schválil(a)"].map((label) => (
            <div key={label}>
              <div className="border-t border-ink pt-1 text-ink-soft">{label}</div>
              <div className="mt-8 border-t border-line pt-1 text-xs text-ink-soft/70">
                Datum a podpis
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
