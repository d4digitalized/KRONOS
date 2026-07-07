-- MCP: osobní API tokeny pro remote MCP server (napojení Toggled do Clauda).
-- Token je vázaný na jednoho uživatele. MCP endpoint z něj podepíše krátkodobý
-- Supabase JWT (sub = user_id), takže veškerá stávající RLS a auth.uid() platí
-- beze změny — žádná nová oprávnění se nezavádějí.

-- ============================================================ tabulka

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null default '',            -- popisek: "Claude web / mobil"
  token_hash text not null unique,          -- SHA-256 hex; plain token NIKDY neukládáme
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index api_tokens_user_idx on public.api_tokens (user_id);

-- ============================================================ RLS
-- Uživatel vidí a spravuje výhradně své tokeny. Plain token se ukáže jen
-- jednou při vytvoření; token_hash je bez plain tokenu k ničemu, proto ho
-- select smí vracet (UI ho stejně nepoužije).

alter table public.api_tokens enable row level security;

create policy api_tokens_select on public.api_tokens for select
  using (user_id = auth.uid());
create policy api_tokens_insert on public.api_tokens for insert
  with check (user_id = auth.uid());
create policy api_tokens_update on public.api_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy api_tokens_delete on public.api_tokens for delete
  using (user_id = auth.uid());

-- ============================================================ resolver
-- MCP endpoint dostane bearer token od NEpřihlášeného requestu (nemá session).
-- Tahle security-definer funkce z hashe vrátí user_id a orazítkuje last_used_at;
-- pro neplatný/zrušený token vrátí null. Nic neúniká — bez platného plain tokenu
-- (SHA-256 z vysoké entropie) hash nikdo netrefí. Service-role klíč tak není
-- v request-cestě vůbec potřeba.

create or replace function public.resolve_api_token(p_hash text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid;
begin
  update public.api_tokens
    set last_used_at = now()
    where token_hash = p_hash and revoked_at is null
    returning user_id into uid;
  return uid;
end;
$$;

-- volatelné i bez přihlášení (MCP route volá RPC s anon klíčem)
grant execute on function public.resolve_api_token(text) to anon, authenticated;
