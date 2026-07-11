-- Vedoucí úkolu: interní člověk, který má na starost splnění úkolu. Nastavuje
-- ho jen admin workspace. Vedoucí úkol vidí (i skrytý) a smí ho dokončit,
-- i když není členem projektu.

-- ============================================================ sloupec

alter table public.tasks
  add column lead_id uuid references public.profiles (id) on delete set null;

create index tasks_lead_idx on public.tasks (lead_id) where lead_id is not null;

-- ============================================================ viditelnost
-- k stávajícím pravidlům přidáváme „nebo jsem vedoucí"

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (not is_private or created_by = auth.uid()
      or public.is_task_assignee(id) or lead_id = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  );

-- vedoucí smí úkol i editovat (typicky dokončit), i bez členství v projektu
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    (not is_private or created_by = auth.uid()
      or public.is_task_assignee(id) or lead_id = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  )
  with check (
    (not is_private or created_by = auth.uid()
      or public.is_task_assignee(id) or lead_id = auth.uid())
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

-- ============================================================ jen admin mění vedoucího
-- RLS na tasks dovoluje editaci i členům projektu; sloupec lead_id ale smí
-- měnit jen admin. Hlídá to trigger (service-role bez auth.uid() důvěřujeme).

create or replace function public.enforce_lead_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- server / cron
  end if;
  if tg_op = 'INSERT' then
    if new.lead_id is not null and not public.is_ws_admin(new.workspace_id) then
      raise exception 'Vedoucího úkolu smí nastavit jen admin';
    end if;
  elsif new.lead_id is distinct from old.lead_id
        and not public.is_ws_admin(new.workspace_id) then
    raise exception 'Vedoucího úkolu smí měnit jen admin';
  end if;
  return new;
end;
$$;

create trigger tasks_enforce_lead
  before insert or update on public.tasks
  for each row execute function public.enforce_lead_admin();

-- ============================================================ aktivita
-- změna vedoucího se propíše do feedu karty

create or replace function public.log_task_lead_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  from_name text;
  to_name text;
begin
  if new.parent_id is not null then
    return new;
  end if;
  if new.lead_id is distinct from old.lead_id then
    select coalesce(nullif(full_name, ''), email) into from_name
    from profiles where id = old.lead_id;
    select coalesce(nullif(full_name, ''), email) into to_name
    from profiles where id = new.lead_id;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (new.workspace_id, new.id, auth.uid(), 'lead_changed',
            jsonb_build_object('from', from_name, 'to', to_name));
  end if;
  return new;
end;
$$;

create trigger on_task_lead_activity
  after update on public.tasks
  for each row execute function public.log_task_lead_activity();
