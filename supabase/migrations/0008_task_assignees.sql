-- Více řešitelů na kartě. Výběr řešitele je omezen na členy projektu
-- (a adminy workspace). Sloupec tasks.assignee_id zůstává jen kvůli
-- zpětné kompatibilitě — aplikace ho už nečte ani nezapisuje.

-- ============================================================ tabulka

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_assignees_user_idx on public.task_assignees (user_id);

-- seed z původního jediného řešitele
insert into public.task_assignees (task_id, user_id)
select id, assignee_id from public.tasks where assignee_id is not null
on conflict do nothing;

-- ============================================================ RLS

alter table public.task_assignees enable row level security;

-- čte a odebírá ten, kdo vidí kartu (exists respektuje RLS tasks)
create policy ta_select on public.task_assignees for select
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy ta_delete on public.task_assignees for delete
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- přiřazuje ten, kdo vidí kartu; řešitel musí být člen projektu karty,
-- nebo admin workspace (ti vidí všechny projekty)
create policy ta_insert on public.task_assignees for insert
  with check (exists (
    select 1 from public.tasks t
    where t.id = task_assignees.task_id
      and (exists (select 1 from public.project_members pm
                   where pm.project_id = t.project_id
                     and pm.user_id = task_assignees.user_id)
        or exists (select 1 from public.workspace_members wm
                   where wm.workspace_id = t.workspace_id
                     and wm.user_id = task_assignees.user_id
                     and wm.role = 'admin'))));

-- ============================================================ notifikace
-- přiřazení nově hlásí insert do task_assignees (starý trigger pryč)

drop trigger on_task_assigned on public.tasks;
drop function public.notify_task_assigned();

create or replace function public.notify_task_assignee_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  t record;
  actor text;
begin
  if new.user_id is distinct from auth.uid() then
    select workspace_id, project_id, title into t from tasks where id = new.task_id;
    select coalesce(nullif(full_name, ''), email) into actor
    from profiles where id = auth.uid();
    insert into notifications
      (user_id, kind, workspace_id, project_id, task_id, task_title, actor_name)
    values
      (new.user_id, 'assigned', t.workspace_id, t.project_id,
       new.task_id, t.title, coalesce(actor, ''));
  end if;
  return new;
end;
$$;

create trigger on_task_assignee_added
  after insert on public.task_assignees
  for each row execute function public.notify_task_assignee_added();

-- komentáře: příjemci jsou všichni řešitelé + autor karty (bez autora komentáře)
create or replace function public.notify_task_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  t record;
  actor text;
  recipient uuid;
begin
  select project_id, title, created_by into t from tasks where id = new.task_id;
  select coalesce(nullif(full_name, ''), email) into actor
  from profiles where id = new.author_id;

  for recipient in
    select distinct u from (
      select user_id as u from task_assignees where task_id = new.task_id
      union
      select t.created_by
    ) s
    where u is not null and u <> new.author_id
  loop
    insert into notifications
      (user_id, kind, workspace_id, project_id, task_id, task_title, actor_name, body)
    values
      (recipient, 'comment', new.workspace_id, t.project_id, new.task_id,
       t.title, coalesce(actor, ''), left(new.body, 300));
  end loop;
  return new;
end;
$$;

-- ============================================================ opakování
-- klon dokončené opakované karty přebírá i řešitele

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
                       description, due_date, created_by, priority, recurrence)
    values (new.workspace_id, new.project_id, new.column_id, new.position,
            new.title, new.description, next_due, new.created_by,
            new.priority, new.recurrence)
    returning id into new_id;

    insert into task_labels (task_id, label_id)
    select new_id, label_id from task_labels where task_id = new.id;

    insert into task_assignees (task_id, user_id)
    select new_id, user_id from task_assignees where task_id = new.id;
  end if;
  return new;
end;
$$;
