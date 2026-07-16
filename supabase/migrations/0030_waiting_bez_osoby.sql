-- Waiting on bez osoby: kartu jde na nástěnce přetáhnout do sloupce
-- Waiting on ručně — vznikne follow-up bez určeného člověka (obě FK null).
-- Dřív CHECK vyžadoval právě jednoho z member/kontakt, teď nejvýš jednoho.

alter table public.task_followups
  drop constraint if exists task_followups_check;
alter table public.task_followups
  add constraint task_followups_one_target
  check (waiting_user_id is null or waiting_contact_id is null);

-- aktivita karty: follow-up bez osoby loguje „—"
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
    elsif new.waiting_contact_id is not null then
      select name into who from contacts where id = new.waiting_contact_id;
    end if;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (ws, new.task_id, auth.uid(), 'followup_set',
            jsonb_build_object('who', coalesce(who, '—')));
    return new;
  else
    -- při mazání karty (cascade) už karta nemusí existovat → nelogovat
    select workspace_id into ws from tasks where id = old.task_id;
    if ws is null then return old; end if;
    if old.waiting_user_id is not null then
      select coalesce(nullif(full_name, ''), email) into who
      from profiles where id = old.waiting_user_id;
    elsif old.waiting_contact_id is not null then
      select name into who from contacts where id = old.waiting_contact_id;
    end if;
    insert into task_activity (workspace_id, task_id, actor_id, kind, meta)
    values (ws, old.task_id, auth.uid(), 'followup_cleared',
            jsonb_build_object('who', coalesce(who, '—')));
    return old;
  end if;
end;
$$;
