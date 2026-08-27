-- Plánované okno úkolu + Google kalendář „Kronos". Uživatel si na kartě
-- vyplní datum a od–do; aplikace přes service account (domain-wide
-- delegation) založí/aktualizuje událost v jeho kalendáři „Kronos".
-- Kalendář se každému vytvoří napoprvé a jeho id se cachuje.

alter table public.tasks
  add column planned_start timestamptz,
  add column planned_end timestamptz;

-- id kalendáře „Kronos" per uživatel (vytváří server přes Google API)
create table public.google_calendars (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  calendar_id text not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendars enable row level security;
-- čtení vlastního záznamu (diagnostika); zápisy dělá jen service role
create policy google_calendars_select on public.google_calendars for select
  using (user_id = auth.uid());

-- vazba úkol × uživatel → id události v jeho kalendáři (kvůli update/smazání)
create table public.task_calendar_events (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id text not null,
  updated_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_calendar_events enable row level security;
create policy tce_select on public.task_calendar_events for select
  using (user_id = auth.uid());
