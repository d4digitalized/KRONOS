-- Členství na projektech: člen workspace vidí jen projekty, na které je přidán.
-- Admin workspace (a super-admin) vidí vše bez ohledu na členství.
-- Stávající projekty se seedují všemi současnými členy workspace,
-- takže nasazení nikomu neodebere přístup — admin pak členy projektů protřídí.

-- ============================================================ tabulka

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

-- seed: všichni současní členové workspace na všechny jeho projekty
insert into public.project_members (project_id, user_id)
select p.id, m.user_id
from public.projects p
join public.workspace_members m on m.workspace_id = p.workspace_id
on conflict do nothing;

-- ============================================================ helper
-- security definer → čte project_members bez rekurze RLS politik

create or replace function public.is_project_member(p uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from project_members
    where project_id = p and user_id = auth.uid())
$$;

-- ============================================================ RLS project_members
-- čte kdokoli, kdo vidí projekt; spravuje admin workspace

alter table public.project_members enable row level security;

create policy pm_select on public.project_members for select
  using (exists (select 1 from public.projects p where p.id = project_id));
create policy pm_insert on public.project_members for insert
  with check (
    exists (select 1 from public.projects p
            where p.id = project_id and public.is_ws_admin(p.workspace_id))
    and exists (select 1 from public.workspace_members m
                join public.projects p on p.id = project_members.project_id
                where m.workspace_id = p.workspace_id
                  and m.user_id = project_members.user_id));
create policy pm_delete on public.project_members for delete
  using (exists (select 1 from public.projects p
                 where p.id = project_id and public.is_ws_admin(p.workspace_id)));

-- ============================================================ zpřísnění viditelnosti
-- projekty: admin vše, člen jen své projekty

drop policy projects_select on public.projects;
create policy projects_select on public.projects for select
  using (public.is_ws_admin(workspace_id) or public.is_project_member(id));

-- karty: viditelnost i editace vázané na projekt
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (public.is_ws_admin(workspace_id) or public.is_project_member(project_id));

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check ((public.is_ws_admin(workspace_id) or public.is_project_member(project_id))
    and created_by = auth.uid()
    and exists (select 1 from public.projects p
                where p.id = project_id and p.workspace_id = tasks.workspace_id)
    and (column_id is null or exists
      (select 1 from public.board_columns c
       where c.id = column_id and c.project_id = tasks.project_id)));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (public.is_ws_admin(workspace_id) or public.is_project_member(project_id))
  with check ((public.is_ws_admin(workspace_id) or public.is_project_member(project_id))
    and exists (select 1 from public.projects p
                where p.id = project_id and p.workspace_id = tasks.workspace_id)
    and (column_id is null or exists
      (select 1 from public.board_columns c
       where c.id = column_id and c.project_id = tasks.project_id)));

-- sloupce nástěnky: kolaborativní v rámci členů projektu
drop policy columns_select on public.board_columns;
create policy columns_select on public.board_columns for select
  using (public.is_ws_admin(workspace_id) or public.is_project_member(project_id));

drop policy columns_insert on public.board_columns;
create policy columns_insert on public.board_columns for insert
  with check ((public.is_ws_admin(workspace_id) or public.is_project_member(project_id))
    and exists (select 1 from public.projects p
                where p.id = project_id and p.workspace_id = board_columns.workspace_id));

drop policy columns_update on public.board_columns;
create policy columns_update on public.board_columns for update
  using (public.is_ws_admin(workspace_id) or public.is_project_member(project_id));

drop policy columns_delete on public.board_columns;
create policy columns_delete on public.board_columns for delete
  using (public.is_ws_admin(workspace_id) or public.is_project_member(project_id));

-- komentáře: vidí jen ten, kdo vidí kartu (exists respektuje RLS tasks)
drop policy comments_select on public.task_comments;
create policy comments_select on public.task_comments for select
  using (public.is_ws_member(workspace_id)
    and exists (select 1 from public.tasks t where t.id = task_id));

-- time_entries beze změny: entries_insert ověřuje projekt přes exists na
-- projects, takže zpřísněný projects_select sám zabrání zápisu času
-- na projekt, kde uživatel není členem (project_id null zůstává povolen).
