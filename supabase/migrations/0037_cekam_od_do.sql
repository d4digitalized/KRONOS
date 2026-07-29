-- Follow-up „Čekám na" dostává dvě data: waiting_since (od kdy čekám, dosud
-- se bralo z created_at) a waiting_until (do kdy slíbil/a dodat). Obojí je
-- samostatná proměnná — waiting_until NENÍ termín úkolu (ten drží tasks.due_date),
-- je to slíbený termín dodání, který sleduju na stránce „Čekám na".

alter table public.task_followups
  add column waiting_since date not null default current_date,
  add column waiting_until date;

-- staré follow-upy: „od" = den, kdy vznikly
update public.task_followups set waiting_since = created_at::date;

-- Dosud šlo follow-up jen zakládat a mazat (0021). Editace dat potřebuje
-- UPDATE — smí ji autor follow-upu nebo admin (stejně jako „Zrušit čekání").
create policy task_followups_update on public.task_followups for update
  using (created_by = auth.uid() or public.is_ws_admin(workspace_id))
  with check (created_by = auth.uid() or public.is_ws_admin(workspace_id));
