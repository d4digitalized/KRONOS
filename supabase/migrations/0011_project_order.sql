-- Pořadí projektů: nastavuje admin ve Správě projektů, respektují ho
-- všechny výpisy a pickery. Seed podle dosavadní abecedy.

alter table public.projects
  add column position double precision not null default 0;

with ordered as (
  select id, row_number() over (partition by workspace_id order by name) as rn
  from public.projects
)
update public.projects p
set position = o.rn
from ordered o
where p.id = o.id;

create index projects_ws_position_idx on public.projects (workspace_id, position);
