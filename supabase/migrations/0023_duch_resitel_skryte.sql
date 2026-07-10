-- Delegace, 3. vlna (viz docs/CONCEPT-delegovane.md):
-- 1) duch jako řešitel — externí kontakt může být řešitelem karty
--    (task_contact_assignees). Duch úkol nevidí a nedostává notifikace,
--    odškrtává za něj zadavatel.
-- 2) skrytý úkol nově vidí autor + jeho řešitelé (dřív jen autor) —
--    admin ani ostatní členové ne.

-- ============================================================ duší řešitelé

create table public.task_contact_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, contact_id)
);

create index task_contact_assignees_contact_idx
  on public.task_contact_assignees (contact_id);

alter table public.task_contact_assignees enable row level security;

-- spravuje kdo vidí kartu; kontakt musí být ze stejného workspace
create policy tca_select on public.task_contact_assignees for select
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy tca_insert on public.task_contact_assignees for insert
  with check (exists (
    select 1 from public.tasks t
    join public.contacts c on c.workspace_id = t.workspace_id
    where t.id = task_contact_assignees.task_id
      and c.id = task_contact_assignees.contact_id));
create policy tca_delete on public.task_contact_assignees for delete
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- aktivita karty: přiřazení/odebrání ducha (stejné kinds jako u členů)
create or replace function public.log_contact_assignee_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  cname text;
begin
  if tg_op = 'INSERT' then
    select workspace_id into ws from tasks where id = new.task_id;
    if ws is null then return new; end if;
    select name into cname from contacts where id = new.contact_id;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (ws, new.task_id, auth.uid(), 'assigned',
            jsonb_build_object('user', cname || ' (duch)'));
    return new;
  else
    select workspace_id into ws from tasks where id = old.task_id;
    if ws is null then return old; end if;
    select name into cname from contacts where id = old.contact_id;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (ws, old.task_id, auth.uid(), 'unassigned',
            jsonb_build_object('user', cname || ' (duch)'));
    return old;
  end if;
end;
$$;

create trigger on_contact_assignee_activity
  after insert or delete on public.task_contact_assignees
  for each row execute function public.log_contact_assignee_activity();

-- ============================================================ skryté úkoly
-- skrytý úkol vidí (a edituje) autor + řešitelé; ostatní včetně admina ne

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (not is_private or created_by = auth.uid() or public.is_task_assignee(id))
    and (
      public.is_ws_admin(workspace_id)
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    (not is_private or created_by = auth.uid() or public.is_task_assignee(id))
    and (
      public.is_ws_admin(workspace_id)
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  )
  with check (
    (not is_private or created_by = auth.uid() or public.is_task_assignee(id))
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

-- řešitele skrytého úkolu už neomezujeme na autora (řešitelé kartu vidí)
drop policy ta_insert on public.task_assignees;
create policy ta_insert on public.task_assignees for insert
  with check (exists (
    select 1 from public.tasks t
    where t.id = task_assignees.task_id
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
-- klon opakované karty přebírá i duší řešitele

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

    insert into task_contact_assignees (task_id, contact_id)
    select new_id, contact_id from task_contact_assignees where task_id = new.id;
  end if;
  return new;
end;
$$;
