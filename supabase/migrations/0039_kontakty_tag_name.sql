-- Tag name (@handle) i pro kontakty ("duchy") — sjednocení s profily
-- a s Tektos adresářem, kde se nick používá pro @zmínky v zápisech.
-- Ukládá se bez zavináče, unikátní v rámci workspace.
alter table public.contacts
  add column tag_name text not null default ''
    check (tag_name = '' or tag_name ~ '^[a-z0-9_.]{2,30}$');

create unique index contacts_tag_name_key
  on public.contacts (workspace_id, lower(tag_name))
  where tag_name <> '';
