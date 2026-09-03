// Skeletony načítání — stejný tvar používá route `loading.tsx` (server-side
// práce stránky) i klientský view, dokud nemá data. Přechod mezi nimi je tak
// bez skoku a bez probliknutí textu „Načítám…".

function Bone({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`animate-pulse rounded bg-black/5 ${className}`}
    />
  );
}

/** Obecný seznam (úkoly, inbox, členové, notifikace…). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      <Bone className="h-7 w-40 rounded-md" />
      <div className="panel divide-y divide-line/50">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <Bone className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bone className="h-3.5 w-1/3" />
              <Bone className="h-3 w-1/5 bg-black/[.04]" />
            </div>
            <Bone className="h-3.5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Nástěnka projektu: hlavička s filtry + sloupce s kartami. */
export function BoardSkeleton() {
  const columns = [4, 2, 1, 5];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" aria-hidden>
      <div className="flex flex-wrap items-center gap-2">
        <Bone className="h-7 w-44 rounded-md" />
        <span className="flex-1" />
        <Bone className="h-8 w-44 rounded-lg" />
        <Bone className="hidden h-8 w-28 rounded-lg sm:block" />
        <Bone className="hidden h-8 w-28 rounded-lg sm:block" />
      </div>
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-hidden pb-1">
        {columns.map((count, c) => (
          <div key={c} className="w-64 shrink-0 rounded-xl bg-black/5 p-2">
            <div className="mb-2 flex items-center gap-2 px-1 py-1">
              <Bone className="h-4 w-24 bg-black/[.07]" />
              <Bone className="h-3 w-4 bg-black/[.05]" />
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: count }).map((_, i) => (
                <div
                  key={i}
                  className="space-y-2.5 rounded-lg border border-line bg-surface p-3 shadow-sm"
                >
                  <Bone className={`h-3.5 ${i % 3 === 0 ? "w-11/12" : "w-2/3"}`} />
                  {i % 3 === 0 && <Bone className="h-3.5 w-1/2" />}
                  <div className="flex items-center justify-between pt-0.5">
                    <Bone className="h-3 w-4 bg-black/[.04]" />
                    <Bone className="h-6 w-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
            <Bone className="mt-2 h-6 w-28 bg-transparent" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Přehled firmy: seznam projektů s tečkou, názvem a avatary. */
export function BoardsListSkeleton() {
  const widths = ["w-48", "w-32", "w-56", "w-40", "w-36", "w-52", "w-28", "w-44"];
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex flex-wrap items-center gap-2">
        <Bone className="h-7 w-28 rounded-md" />
        <Bone className="h-3 w-16 bg-black/[.04]" />
        <span className="flex-1" />
        <Bone className="h-8 w-56 rounded-lg" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {["w-12", "w-20", "w-16", "w-24"].map((w) => (
          <Bone key={w} className={`h-6 rounded-full ${w}`} />
        ))}
      </div>
      <div className="panel divide-y divide-line/50">
        {widths.map((w, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
            <Bone className="h-2.5 w-2.5 shrink-0 rounded-full bg-black/10" />
            <Bone className={`h-3.5 ${w}`} />
            <span className="flex-1" />
            {i % 2 === 0 && <Bone className="h-4 w-14 rounded-full bg-black/[.04]" />}
            <span className="flex items-center gap-1">
              <Bone className="h-6 w-6 rounded-full" />
              {i % 3 !== 1 && <Bone className="h-6 w-6 rounded-full" />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Můj den: nadpis, pruh dnů, hodinová osa a panel úkolů vpravo. */
export function MyDaySkeleton() {
  const hours = 10;
  return (
    <div
      className="grid w-full items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]"
      aria-hidden
    >
      <div className="min-w-0 space-y-4">
        <div className="space-y-1.5">
          <Bone className="h-7 w-28 rounded-md" />
          <Bone className="h-3 w-64 bg-black/[.04]" />
        </div>
        <div className="flex items-center gap-1.5 panel p-2">
          <Bone className="h-7 w-6 rounded-md bg-transparent" />
          <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className={`flex flex-col items-center gap-1.5 rounded-lg px-1 py-2 ${
                  i === 2 ? "bg-black/5" : ""
                }`}
              >
                <Bone className="h-3 w-8" />
                <Bone className="h-2.5 w-3 bg-black/[.04]" />
              </div>
            ))}
          </div>
          <Bone className="h-7 w-6 rounded-md bg-transparent" />
        </div>
        <div className="panel overflow-hidden">
          <div className="relative" style={{ height: hours * 56 }}>
            {Array.from({ length: hours }).map((_, i) => (
              <div key={i}>
                <div
                  style={{ top: i * 56 }}
                  className="absolute left-0 right-0 border-t border-line/50"
                />
                <Bone
                  className="absolute left-2 h-2.5 w-8 bg-black/[.04]"
                  style={{ top: i * 56 + 4 }}
                />
              </div>
            ))}
            <div
              className="absolute left-14 right-3 animate-pulse rounded-lg bg-black/[.06]"
              style={{ top: 2 * 56 + 2, height: 56 - 4 }}
            />
            <div
              className="absolute left-14 right-3 animate-pulse rounded-lg bg-black/[.06]"
              style={{ top: 5 * 56 + 2, height: 2 * 56 - 4 }}
            />
          </div>
        </div>
      </div>
      <aside className="panel space-y-3 p-3">
        <Bone className="h-5 w-32" />
        <Bone className="h-8 w-full rounded-lg" />
        <div className="space-y-0.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-1 py-2">
              <Bone className="h-2 w-2 shrink-0 rounded-full bg-black/10" />
              <Bone className={`h-3.5 ${i % 2 ? "w-3/5" : "w-4/5"}`} />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
