-- Delegace, 2. vlna (viz docs/CONCEPT-delegovane.md):
-- 1) úkoly bez projektu — vidí je zadavatel + řešitelé (+ admin), nejsou na
--    žádné nástěnce; projekt jde doplnit později v kartě
-- 2) skryté úkoly (tasks.is_private) — vidí je JEN autor (ani admin, ani
--    nikdo jiný); nesmí mít cizí řešitele, tiché „Čekám na" funguje dál
-- 3) workspace_members.can_delegate / can_hide — admin odemyká delegaci
--    („Čekám na", stránka Delegované) a skryté úkoly per člen

-- ============================================================ helper

-- security definer → čte task_assignees bez rekurze RLS politik
-- (tasks_select se ptá na task_assignees, jehož politiky se ptají na tasks)
create or replace function public.is_task_assignee(t uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from task_assignees
    where task_id = t and user_id = auth.uid())
$$;

-- ============================================================ sloupce

alter table public.tasks alter column project_id drop not null;
alter table public.tasks add column is_private boolean not null default false;

alter table public.workspace_members
  add column can_delegate boolean not null default false;
alter table public.workspace_members
  add column can_hide boolean not null default false;

-- ============================================================ RLS tasks

-- skrytý úkol vidí jen autor; jinak: projektové karty jako dosud,
-- bez projektu jen autor + řešitelé (admin workspace vidí vše neskryté)
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  );

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (
    created_by = auth.uid()
    and (
      (project_id is not null
        and (public.is_ws_admin(workspace_id) or public.is_project_member(project_id))
        and exists (select 1 from public.projects p
                    where p.id = project_id and p.workspace_id = tasks.workspace_id)
        and (column_id is null or exists
          (select 1 from public.board_columns c
           where c.id = column_id and c.project_id = tasks.project_id)))
      or (project_id is null
        and public.is_ws_member(workspace_id)
        and column_id is null)
    )
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  )
  with check (
    (not is_private or created_by = auth.uid())
    and (
      (project_id is not null
        and (public.is_ws_admin(workspace_id) or public.is_project_member(project_id))
        and exists (select 1 from public.projects p
                    where p.id = project_id and p.workspace_id = tasks.workspace_id)
        and (column_id is null or exists
          (select 1 from public.board_columns c
           where c.id = column_id and c.project_id = tasks.project_id)))
      or (project_id is null
        and public.is_ws_member(workspace_id)
        and column_id is null)
    )
  );

-- ============================================================ RLS řešitelé

-- u projektové karty člen projektu nebo admin (jako dosud); u karty bez
-- projektu kterýkoli člen workspace; skrytá karta jen autor sám sobě.
-- Kandidáty dál filtruje aplikace přes assign_grants.
drop policy ta_insert on public.task_assignees;
create policy ta_insert on public.task_assignees for insert
  with check (exists (
    select 1 from public.tasks t
    where t.id = task_assignees.task_id
      and (not t.is_private or task_assignees.user_id = t.created_by)
      and (
        (t.project_id is not null and (
          exists (select 1 from public.project_members pm
                  where pm.project_id = t.project_id
                    and pm.user_id = task_assignees.user_id)
          or exists (select 1 from public.workspace_members wm
                     where wm.workspace_id = t.workspace_id
                       and wm.user_id = task_assignees.user_id
                       and wm.role = 'admin')))
        or (t.project_id is null and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = t.workspace_id
            and wm.user_id = task_assignees.user_id))
      )));

-- ============================================================ opakování

-- klon opakované karty přebírá i příznak skrytí (jinak by se soukromá
-- karta dalším výskytem zveřejnila)
create or replace function public.handle_recurring_task()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  base date;
  next_due date;
  new_id uuid;
begin
  if new.completed_at is not null and old.completed_at is null
     and new.recurrence is not null and new.parent_id is null then
    base := coalesce(new.due_date, current_date);
    next_due := case new.recurrence
      when 'daily' then base + 1
      when 'weekdays' then case extract(isodow from base)::int
        when 5 then base + 3  -- pá → po
        when 6 then base + 2  -- so → po
        else base + 1 end
      when 'weekly' then base + 7
      when 'monthly' then (base + interval '1 month')::date
      when 'yearly' then (base + interval '1 year')::date
    end;

    insert into tasks (workspace_id, project_id, column_id, position, title,
                       description, due_date, created_by, priority, recurrence,
                       is_private)
    values (new.workspace_id, new.project_id, new.column_id, new.position,
            new.title, new.description, next_due, new.created_by,
            new.priority, new.recurrence, new.is_private)
    returning id into new_id;

    insert into task_labels (task_id, label_id)
    select new_id, label_id from task_labels where task_id = new.id;

    insert into task_assignees (task_id, user_id)
    select new_id, user_id from task_assignees where task_id = new.id;
  end if;
  return new;
end;
$$;
