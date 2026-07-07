-- Notifikační e-mail per uživatel × firma. Nastavuje admin workspace v Členech.
-- Prázdné = notifikace chodí na účetní (přihlašovací) e-mail uživatele.
-- Zápis jde přes server action (service-role) s kontrolou is_ws_admin, proto
-- tu neuvolňujeme RLS/grant — update workspace_members zůstává jinak jen
-- pro super-admina.

alter table public.workspace_members
  add column notify_email text not null default ''
    check (
      notify_email = ''
      or notify_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    );
