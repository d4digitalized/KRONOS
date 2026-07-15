-- HR: admin členovi zapne flag can_hr a přidělí lidi (hr_grants), jejichž
-- výkazy pak člen vidí v Přehledech a smí je exportovat do PDF (/vykaz).
-- Bez sazby — tu do exportu vkládá jen admin. Adminům flag netřeba,
-- výkazy všech vidí vždy.

alter table public.workspace_members
  add column can_hr boolean not null default false;

-- ============================================================ granty
-- user_id (HR) smí číst výkazy target_id; per workspace, spravuje admin.

create table public.hr_grants (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id, target_id)
);

alter table public.hr_grants enable row level security;

create policy hr_grants_select on public.hr_grants for select
  using (public.is_ws_member(workspace_id));
create policy hr_grants_insert on public.hr_grants for insert
  with check (public.is_ws_admin(workspace_id));
create policy hr_grants_delete on public.hr_grants for delete
  using (public.is_ws_admin(workspace_id));

-- ============================================================ výkazy
-- navíc k autorovi a adminovi je vidí HR s grantem na daného člověka;
-- flag can_hr se kontroluje taky — vypnutí HR práva okamžitě zavře i granty

drop policy entries_select on public.time_entries;
create policy entries_select on public.time_entries for select
  using (
    user_id = auth.uid()
    or public.is_ws_admin(workspace_id)
    or exists (
      select 1
      from public.hr_grants g
      join public.workspace_members wm
        on wm.workspace_id = g.workspace_id and wm.user_id = g.user_id
      where g.workspace_id = time_entries.workspace_id
        and g.user_id = auth.uid()
        and g.target_id = time_entries.user_id
        and wm.can_hr
    )
  );
