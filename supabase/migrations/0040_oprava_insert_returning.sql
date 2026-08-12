-- Oprava 0039: běžným členům padalo založení projektové karty na RLS
-- („new row violates row-level security"). INSERT ... RETURNING kontroluje
-- vrácenou řádku select politikou; is_task_mine() ale čte tasks ve snapshotu
-- z počátku příkazu, kdy čerstvá karta ještě neexistuje → false → chyba.
-- Autorství proto testujeme přímo sloupcem created_by = auth.uid(), který se
-- vyhodnocuje nad samotnou řádkou. Admini fungovali díky zkratce is_ws_admin.

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id)
          and (created_by = auth.uid() -- přímo na řádce: drží i INSERT ... RETURNING
               or public.is_task_mine(id)
               or (parent_id is not null and public.is_task_mine(parent_id))))
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
      or (project_id is not null and public.is_project_member(project_id)
          and (created_by = auth.uid()
               or public.is_task_mine(id)
               or (parent_id is not null and public.is_task_mine(parent_id))))
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
