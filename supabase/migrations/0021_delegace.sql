-- Delegované úkoly („čekám na", GTD: Waiting For) — viz docs/CONCEPT-delegovane.md.
-- Externí kontakty bez účtu + follow-up na kartě: úkol se zadáním nezavírá,
-- přejde do čekání na člena či kontakt a sbírá se na stránce Delegované.

-- ============================================================ kontakty

-- Externí lidé bez účtu, sdílení za workspace. Jen evidence — se systémem
-- nijak neinteragují, stav úkolu za ně mění zadavatel.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  email text not null default '',
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index contacts_ws_idx on public.contacts (workspace_id);

-- ============================================================ follow-upy

-- Jedno čekání na úkol (PK = task_id); hlídá ho created_by. Čeká se buď na
-- člena (waiting_user_id), nebo na kontakt (waiting_contact_id) — právě jeden.
create table public.task_followups (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  waiting_user_id uuid references public.profiles (id) on delete cascade,
  waiting_contact_id uuid references public.contacts (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((waiting_user_id is null) <> (waiting_contact_id is null))
);

create index task_followups_creator_idx on public.task_followups (workspace_id, created_by);

-- ============================================================ RLS

alter table public.contacts enable row level security;
alter table public.task_followups enable row level security;

-- kontakty: kolaborativní v rámci workspace (jako štítky), maže admin
create policy contacts_select on public.contacts for select
  using (public.is_ws_member(workspace_id));
create policy contacts_insert on public.contacts for insert
  with check (public.is_ws_member(workspace_id));
create policy contacts_update on public.contacts for update
  using (public.is_ws_member(workspace_id));
create policy contacts_delete on public.contacts for delete
  using (public.is_ws_admin(workspace_id));

-- follow-upy: čte/ruší kdo vidí kartu; zakládá jen pod svým jménem a kontakt
-- musí být ze stejného workspace jako karta
create policy task_followups_select on public.task_followups for select
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy task_followups_insert on public.task_followups for insert
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.tasks t
                where t.id = task_followups.task_id
                  and t.workspace_id = task_followups.workspace_id)
    and (waiting_contact_id is null
         or exists (select 1 from public.contacts c
                    where c.id = task_followups.waiting_contact_id
                      and c.workspace_id = task_followups.workspace_id))
  );
create policy task_followups_delete on public.task_followups for delete
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- ============================================================ aktivita karty

-- nastavení / zrušení čekání do feedu aktivit
create or replace function public.log_followup_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  who text;
begin
  if tg_op = 'INSERT' then
    select workspace_id into ws from tasks where id = new.task_id;
    if ws is null then return new; end if;
    if new.waiting_user_id is not null then
      select coalesce(nullif(full_name, ''), email) into who
      from profiles where id = new.waiting_user_id;
    else
      select name into who from contacts where id = new.waiting_contact_id;
    end if;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (ws, new.task_id, auth.uid(), 'followup_set', jsonb_build_object('who', who));
    return new;
  else
    -- při mazání karty (cascade) už karta nemusí existovat → nelogovat
    select workspace_id into ws from tasks where id = old.task_id;
    if ws is null then return old; end if;
    if old.waiting_user_id is not null then
      select coalesce(nullif(full_name, ''), email) into who
      from profiles where id = old.waiting_user_id;
    else
      select name into who from contacts where id = old.waiting_contact_id;
    end if;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (ws, old.task_id, auth.uid(), 'followup_cleared', jsonb_build_object('who', who));
    return old;
  end if;
end;
$$;

create trigger on_followup_activity
  after insert or delete on public.task_followups
  for each row execute function public.log_followup_activity();
