-- Kategorie projektů: každá firma si zakládá vlastní (Development, Real
-- estate, Construction…). Projekt patří nejvýš do jedné; podle nich se dá
-- filtrovat seznam projektů. Spravuje admin ve Správě projektů.

create table public.project_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  /** hex barva pilulky; prázdné = odvodí se z id jako u projektů */
  color text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index project_categories_ws_idx on public.project_categories (workspace_id, position);

alter table public.project_categories enable row level security;

-- kategorie vidí každý člen firmy, spravuje je admin
create policy project_categories_select on public.project_categories for select
  using (public.is_ws_member(workspace_id));
create policy project_categories_insert on public.project_categories for insert
  with check (public.is_ws_admin(workspace_id));
create policy project_categories_update on public.project_categories for update
  using (public.is_ws_admin(workspace_id));
create policy project_categories_delete on public.project_categories for delete
  using (public.is_ws_admin(workspace_id));

-- smazaná kategorie projekty neruší, jen je nechá bez zařazení
alter table public.projects
  add column category_id uuid references public.project_categories (id) on delete set null;

create index projects_category_idx on public.projects (category_id) where category_id is not null;
