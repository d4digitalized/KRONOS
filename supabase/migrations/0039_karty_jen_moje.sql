-- Karty vidí jen jejich lidé — i uvnitř projektu. Členství v projektu už
-- nestačí; kartu vidí autor, řešitel, vedoucí a šéf řešitele (assign_grants),
-- podúkoly dědí viditelnost rodiče. Admin vidí vše. Protože je to RLS,
-- platí to všude: nástěnky, Task force, pickery karet u zápisu času,
-- přehledy i MCP/API. (Dosud to hlídalo jen UI nástěnky a Task force.)

-- „moje karta": autor / vedoucí / řešitel / řešitelem je někdo z mých grantů.
-- SECURITY DEFINER: čte tasks uvnitř policy nad tasks — bez toho by RLS
-- rekurzivně volala sama sebe.
create or replace function public.is_task_mine(tid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from tasks t
    where t.id = tid
      and (
        t.created_by = auth.uid()
        or t.lead_id = auth.uid()
        or exists (
          select 1 from task_assignees ta
          where ta.task_id = t.id
            and (
              ta.user_id = auth.uid()
              or exists (
                select 1 from assign_grants g
                where g.workspace_id = t.workspace_id
                  and g.user_id = auth.uid()
                  and g.target_id = ta.user_id
              )
            )
        )
      )
  )
$$;

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id)
          and (public.is_task_mine(id)
               or (parent_id is not null and public.is_task_mine(parent_id))))
      or (project_id is null and public.is_ws_member(workspace_id)
          and (created_by = auth.uid() or public.is_task_assignee(id)))
    )
  );

-- editace: stejný okruh lidí (with check s pravidly projektu/sloupce z 0027)
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (
    (not is_private or created_by = auth.uid())
    and (
      public.is_ws_admin(workspace_id)
      or lead_id = auth.uid()
      or (project_id is not null and public.is_project_member(project_id)
          and (public.is_task_mine(id)
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
