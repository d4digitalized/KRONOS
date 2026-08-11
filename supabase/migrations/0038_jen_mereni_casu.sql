-- „Jen měření času": osekané rozhraní pro členy, kteří v Kronosu jen
-- vykazují hodiny na projekty (timer + Report). Úkoly na ně jde dál věšet,
-- ale sami vidí pouze měřicí obrazovku — menu se zúží na Report a ostatní
-- stránky firmy je přesměrují. Čistě UI flag, práva (RLS) se nemění.
-- Zapíná admin v Členech; adminům se flag ignoruje.

alter table public.workspace_members
  add column time_only boolean not null default false;
