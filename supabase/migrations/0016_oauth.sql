-- MCP OAuth: aby šel Toggled přidat jako custom connector do webového/mobilního
-- Clauda (ten neumí vložit token, jede přes OAuth). Toggled je zároveň
-- Authorization Server: uživatele autentizuje stávající Supabase login, pak
-- vydává vlastní auth kódy a access tokeny vázané na jeho user_id.
--
-- Tyto tabulky drží serverové tajnosti (kódy, refresh tokeny, registrace klientů)
-- a spravuje je výhradně serverová logika přes service role — proto RLS zapnuto
-- BEZ politik (jako fronta notifikací). Data uživatele se přes ně nikdy nečtou.

-- ============================================================ registrovaní klienti (DCR)

create table public.oauth_clients (
  client_id text primary key,
  client_name text not null default '',
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

-- ============================================================ autorizační kódy (jednorázové, krátké)

create table public.oauth_auth_codes (
  code_hash text primary key,              -- SHA-256; plain kód drží jen klient
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,            -- PKCE S256
  scope text not null default '',
  resource text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_auth_codes_expiry_idx on public.oauth_auth_codes (expires_at);

-- ============================================================ refresh tokeny (rotované)

create table public.oauth_refresh_tokens (
  token_hash text primary key,             -- SHA-256; plain drží jen klient
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_refresh_user_idx on public.oauth_refresh_tokens (user_id);

-- ============================================================ RLS: jen service role
-- Záměrně žádné politiky pro authenticated/anon — čte a zapisuje pouze
-- serverová OAuth logika (service role), nikdy klient přímo.

alter table public.oauth_clients enable row level security;
alter table public.oauth_auth_codes enable row level security;
alter table public.oauth_refresh_tokens enable row level security;
