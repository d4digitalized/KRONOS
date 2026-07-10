---
name: verify
description: Jak ověřit změny v Toggled — build, dev server a limity prostředí (Supabase bez lokální instance, migrace ručně).
---

# Ověřování změn v Toggled

## Build a spuštění

- `npm run build` — plný typecheck + build (Next.js App Router, Turbopack).
- `npm run dev` — dev server na http://localhost:3000; `.env.local` míří na
  sdílenou Supabase instanci (žádná lokální DB neběží).
- Nepřihlášený požadavek na jakoukoli `/w/...` routu vrací 307 → `/login`
  (middleware) — rychlý smoke test, že routa existuje a auth-gate funguje.

## Limity prostředí (co e2e nejde bez uživatele)

- **Migrace se aplikují ručně** přes Supabase SQL editor (není CLI ani DB URL)
  — nová tabulka v `supabase/migrations/` v DB neexistuje, dokud ji uživatel
  nespustí. Klientské dotazy na neexistující tabulku vrací error → UI má
  degradovat potichu (vzor: kontrolovat `res.error` před `setState`).
- **Nejsou testovací přihlašovací údaje** — přihlášený flow (nástěnky, karty)
  nejde odbavit automatizovaně; ověření za loginem dělá uživatel ručně.

## Co tedy reportovat

Build + boot + auth-gate smoke = maximum bez uživatele; všechno za loginem
označit jako neověřené a napsat uživateli konkrétní kroky k ručnímu ověření.
