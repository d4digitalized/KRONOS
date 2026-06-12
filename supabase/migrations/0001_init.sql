-- Toggled: úkolovník s měřením času (Todoist × Toggl)
-- Schéma + RLS. Role: member / admin (per workspace), super-admin (globální flag).

-- ============================================================ tabulky

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  check (stopped_at is null or stopped_at > started_at)
);

-- max. jeden běžící timer na uživatele (napříč workspaces)
create unique index one_running_timer_per_user
  on public.time_entries (user_id) where stopped_at is null;

create index tasks_workspace_idx on public.tasks (workspace_id, completed_at);
create index time_entries_ws_started_idx on public.time_entries (workspace_id, started_at);
create index time_entries_user_idx on public.time_entries (user_id, started_at);
create index projects_workspace_idx on public.projects (workspace_id);

-- ============================================================ profil při registraci

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ RLS helpery
-- security definer → čtou workspace_members bez rekurze RLS politik

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_ws_member(ws uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid())
$$;

create or replace function public.is_ws_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.shares_workspace(other uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from workspace_members a
    join workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other)
$$;

-- ============================================================ RLS politiky

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.time_entries enable row level security;

-- profiles: vidím sebe + lidi ze společných workspaces; měnit jen své jméno
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_super_admin() or public.shares_workspace(id));
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- is_super_admin flag nesmí jít změnit přes API (bootstrap ručně v SQL editoru)
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- workspaces: čte člen, spravuje jen super-admin
create policy workspaces_select on public.workspaces for select
  using (public.is_ws_member(id));
create policy workspaces_insert on public.workspaces for insert
  with check (public.is_super_admin());
create policy workspaces_update on public.workspaces for update
  using (public.is_super_admin());
create policy workspaces_delete on public.workspaces for delete
  using (public.is_super_admin());

-- workspace_members: čte člen; member přidává admin, admina jen super-admin;
-- role mění jen super-admin; odebrat membera může admin, admina super-admin, sebe každý
create policy members_select on public.workspace_members for select
  using (public.is_ws_member(workspace_id));
create policy members_insert on public.workspace_members for insert
  with check (public.is_ws_admin(workspace_id)
    and (role = 'member' or public.is_super_admin()));
create policy members_update on public.workspace_members for update
  using (public.is_super_admin());
create policy members_delete on public.workspace_members for delete
  using (public.is_super_admin()
    or (public.is_ws_admin(workspace_id) and role = 'member')
    or user_id = auth.uid());

-- projects: čte člen, spravuje admin
create policy projects_select on public.projects for select
  using (public.is_ws_member(workspace_id));
create policy projects_insert on public.projects for insert
  with check (public.is_ws_admin(workspace_id));
create policy projects_update on public.projects for update
  using (public.is_ws_admin(workspace_id));
create policy projects_delete on public.projects for delete
  using (public.is_ws_admin(workspace_id));

-- tasks: zakládá a edituje kterýkoli člen, maže autor nebo admin
create policy tasks_select on public.tasks for select
  using (public.is_ws_member(workspace_id));
create policy tasks_insert on public.tasks for insert
  with check (public.is_ws_member(workspace_id)
    and created_by = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = project_id and p.workspace_id = tasks.workspace_id));
create policy tasks_update on public.tasks for update
  using (public.is_ws_member(workspace_id))
  with check (public.is_ws_member(workspace_id)
    and exists (select 1 from public.projects p
                where p.id = project_id and p.workspace_id = tasks.workspace_id));
create policy tasks_delete on public.tasks for delete
  using (created_by = auth.uid() or public.is_ws_admin(workspace_id));

-- time_entries: svoje vidí a edituje každý, admin vidí a koriguje vše ve workspace
create policy entries_select on public.time_entries for select
  using (user_id = auth.uid() or public.is_ws_admin(workspace_id));
create policy entries_insert on public.time_entries for insert
  with check (user_id = auth.uid()
    and public.is_ws_member(workspace_id)
    and exists (select 1 from public.tasks t
                where t.id = task_id and t.workspace_id = time_entries.workspace_id));
create policy entries_update on public.time_entries for update
  using (user_id = auth.uid() or public.is_ws_admin(workspace_id));
create policy entries_delete on public.time_entries for delete
  using (user_id = auth.uid() or public.is_ws_admin(workspace_id));
