// Skeleton během server-side práce stránky (auth + role) při přepnutí sekce.
// Drží dojem okamžité odezvy, než se namountuje klientský view.
export default function Loading() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-7 w-40 animate-pulse rounded-md bg-black/5" />
      <div className="panel divide-y divide-line/50">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-black/5" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-black/5" />
              <div className="h-3 w-1/5 animate-pulse rounded bg-black/[.04]" />
            </div>
            <div className="h-3.5 w-12 animate-pulse rounded bg-black/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
