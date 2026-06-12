"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { entrySeconds, fmtDuration } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsView({ wsId }: { wsId: string }) {
  const supabase = createClient();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const toExclusive = new Date(`${to}T00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);
    const { data } = await supabase
      .from("time_entries")
      .select(
        "id, started_at, stopped_at, user_id, profiles(full_name, email), tasks(project_id, projects(name))"
      )
      .eq("workspace_id", wsId)
      .not("stopped_at", "is", null)
      .gte("started_at", new Date(`${from}T00:00`).toISOString())
      .lt("started_at", toExclusive.toISOString());
    setEntries((data as unknown as TimeEntry[]) ?? []);
    setLoading(false);
  }, [supabase, wsId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const byPerson = new Map<string, number>();
  const byProject = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    const seconds = entrySeconds(entry.started_at, entry.stopped_at);
    total += seconds;
    const person = entry.profiles?.full_name || entry.profiles?.email || "?";
    byPerson.set(person, (byPerson.get(person) ?? 0) + seconds);
    const project = entry.tasks?.projects?.name ?? "?";
    byProject.set(project, (byProject.get(project) ?? 0) + seconds);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
        <span className="text-sm font-medium">Období</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <span className="text-neutral-400">–</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
        />
        <span className="ml-auto text-sm text-neutral-500">
          Celkem <span className="font-mono font-medium">{fmtDuration(total)} h</span>
        </span>
      </div>

      {loading ? (
        <p className="p-4 text-neutral-400">Načítám…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Po lidech", sorted(byPerson)],
              ["Po projektech", sorted(byProject)],
            ] as const
          ).map(([title, rows]) => (
            <div key={title} className="rounded-xl border border-neutral-200 bg-white">
              <h2 className="border-b border-neutral-100 px-3 py-2 text-sm font-semibold">
                {title}
              </h2>
              {rows.length === 0 ? (
                <p className="p-3 text-sm text-neutral-400">Žádná data za období.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map(([name, seconds]) => (
                      <tr key={name} className="border-b border-neutral-50 last:border-0">
                        <td className="px-3 py-2">{name}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {fmtDuration(seconds)} h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-400">
        Běžící (nezastavené) timery se do přehledu nepočítají.
      </p>
    </div>
  );
}
