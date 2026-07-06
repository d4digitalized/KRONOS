-- Backlog: výchozí sloupec každého projektu. Karty bez sloupce
-- (import, smazaný sloupec, zadání mimo nástěnku) padají do prvního
-- sloupce projektu — Backlog se zakládá jako první.

-- 1) doplnit Backlog stávajícím projektům (pokud ho nemají)
insert into public.board_columns (workspace_id, project_id, name, position)
select p.workspace_id, p.id, 'Backlog',
       coalesce(
         (select min(c.position) from public.board_columns c where c.project_id = p.id),
         2048
       ) - 1024
from public.projects p
where not exists (
  select 1 from public.board_columns c
  where c.project_id = p.id and lower(c.name) = 'backlog');

-- 2) stávající karty bez sloupce → první sloupec projektu
update public.tasks t
set column_id = (
  select c.id from public.board_columns c
  where c.project_id = t.project_id
  order by c.position
  limit 1)
where t.column_id is null and t.parent_id is null;

-- 3) nový projekt dostane Backlog automaticky
create or replace function public.create_default_backlog()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into board_columns (workspace_id, project_id, name, position)
  values (new.workspace_id, new.id, 'Backlog', 1024);
  return new;
end;
$$;

create trigger on_project_created_backlog
  after insert on public.projects
  for each row execute function public.create_default_backlog();

-- 4) karta bez sloupce padá do prvního sloupce projektu
--    (insert i smazání sloupce, které přes FK nastaví column_id na null)
create or replace function public.assign_default_column()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.parent_id is null and new.column_id is null then
    select id into new.column_id
    from board_columns
    where project_id = new.project_id
    order by position
    limit 1;
  end if;
  return new;
end;
$$;

create trigger on_task_default_column
  before insert or update of column_id on public.tasks
  for each row execute function public.assign_default_column();
