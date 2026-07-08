// Drobná paměťová cache pro data načítaná ve view komponentách.
// Cíl: navigace zpět / přepnutí tabu ukáže poslední data OKAMŽITĚ a data se
// jen na pozadí revaliduje (stale-while-revalidate). Žije po dobu session
// v paměti záložky; při reloadu se přirozeně vyprázdní.
//
// Použití ve view:
//   const cached = cacheGet<Payload>(key);
//   const [data, setData] = useState(cached?.data ?? []);
//   const [loading, setLoading] = useState(!cached);
//   ... v load(): po fetchi cacheSet(key, payload) a setLoading(false)

const store = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet(key: string, value: unknown): void {
  store.set(key, value);
}

export function cacheHas(key: string): boolean {
  return store.has(key);
}

/** Zneplatní konkrétní klíč (nebo vše), např. po odhlášení. */
export function cacheClear(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
