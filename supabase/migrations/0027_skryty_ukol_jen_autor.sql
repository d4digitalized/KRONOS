-- Skrytý úkol vidí JEN jeho autor. Řešitelé, vedoucí, admin — nikdo jiný;
-- a nechodí z něj žádné notifikace (přiřazení, komentáře, denní přehled).
-- Vrací sémantiku z dob před 0023 (tam se viditelnost rozšířila na řešitele).
-- Ostatní pravidla (projekty, úkoly bez projektu, vedoucí) beze změny z 0025.

-- ============================================================ viditelnost

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  )
  with check (
    (not is_private or created_by = auth.uid())
    and (
      (project_id is not null
        and (public.is_ws_admin(workspace_id)
             or public.is_project_member(project_id)
             or lead_id = auth.uid())
        and exists (select 1 from public.projects p
                    where p.id = project_id and p.workspace_id = tasks.workspace_id)
        and (column_id is null or exists
          (select 1 from public.board_columns c
           where c.id = column_id and c.project_id = tasks.project_id)))
      or (project_id is null
        and (public.is_ws_member(workspace_id) or lead_id = auth.uid())
        and column_id is null)
    )
  );

-- ============================================================ notifikace
-- přiřazení na skrytý úkol se řešiteli nehlásí (nemá ho jak vidět)

create or replace function public.notify_task_assignee_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  t record;
  actor text;
begin
  select workspace_id, project_id, title, is_private
  into t from tasks where id = new.task_id;
  if t.is_private then
    return new;
  end if;
  if new.user_id is distinct from auth.uid() then
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

-- komentáře a zmínky na skrytém úkolu neposílají nic (vidí ho jen autor,
-- takže tam stejně může psát jen on)

create or replace function public.notify_task_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  t record;
  actor text;
  recipient uuid;
  mentioned uuid[];
begin
  select project_id, title, created_by, is_private
  into t from tasks where id = new.task_id;
  if t.is_private then
    return new;
  end if;
  select coalesce(nullif(full_name, ''), email) into actor
  from profiles where id = new.author_id;

  -- @tagy z textu → uživatelé se shodným tag_name, členové stejného workspace
  select coalesce(array_agg(distinct p.id), '{}') into mentioned
  from regexp_matches(new.body, '@([a-z0-9_.]{2,30})', 'g') as m
  join profiles p on p.tag_name <> '' and lower(p.tag_name) = lower(m[1])
  join workspace_members wm
    on wm.workspace_id = new.workspace_id and wm.user_id = p.id
  where p.id <> new.author_id;

  foreach recipient in array mentioned loop
    insert into notifications
      (user_id, kind, workspace_id, project_id, task_id, task_title, actor_name, body)
    values
      (recipient, 'mention', new.workspace_id, t.project_id, new.task_id,
       t.title, coalesce(actor, ''), left(new.body, 300));
  end loop;

  for recipient in
    select distinct u from (
      select user_id as u from task_assignees where task_id = new.task_id
      union
      select t.created_by
    ) s
    where u is not null and u <> new.author_id and u <> all(mentioned)
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
