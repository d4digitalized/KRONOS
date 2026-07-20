-- Priority list: osobní pořadí úkolů napříč všemi firmami. Každý si řadí
-- jen svoje (drag & drop), nikdo jiný to nevidí ani nemění. Úkoly bez
-- záznamu se řadí na konec (podle termínu) — pořadí vzniká až přetažením.

create table public.task_priority (
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  position double precision not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

create index task_priority_user_idx on public.task_priority (user_id, position);

alter table public.task_priority enable row level security;

-- čistě osobní tabulka: vidí a mění jen vlastník řádku
create policy task_priority_select on public.task_priority for select
  using (user_id = auth.uid());
create policy task_priority_insert on public.task_priority for insert
  with check (user_id = auth.uid());
create policy task_priority_update on public.task_priority for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy task_priority_delete on public.task_priority for delete
  using (user_id = auth.uid());
