-- Vypnutí e-mailových notifikací člena adminem, per firma. Vypnuté = členovi
-- z této firmy nechodí žádné e-maily (přiřazení, komentáře, zmínky, denní
-- přehled); zvoneček v aplikaci zůstává. Zápis jde přes server action
-- (service-role) s kontrolou is_ws_admin, stejně jako notify_email.

alter table public.workspace_members
  add column notify_enabled boolean not null default true;
