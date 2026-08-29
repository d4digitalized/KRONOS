-- HR s grantem smí výkazy přidělených lidí i upravovat (popis, časy,
-- projekt) — dosud je směl jen číst (0026). Mazání zůstává autorovi
-- záznamu a adminovi. Vypnutí flagu can_hr právo okamžitě zavře.

drop policy entries_update on public.time_entries;
create policy entries_update on public.time_entries for update
  using (
    user_id = auth.uid()
    or public.is_ws_admin(workspace_id)
    or exists (
      select 1
      from public.hr_grants g
      join public.workspace_members wm
        on wm.workspace_id = g.workspace_id and wm.user_id = g.user_id
      where g.workspace_id = time_entries.workspace_id
        and g.user_id = auth.uid()
        and g.target_id = time_entries.user_id
        and wm.can_hr
    )
  );
