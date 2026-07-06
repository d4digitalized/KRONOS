-- Tag name (@handle) uživatele: nastavuje admin, unikátní napříč
-- portálem (bez ohledu na velikost písmen). Ukládá se bez zavináče.

alter table public.profiles
  add column tag_name text not null default ''
    check (tag_name = '' or tag_name ~ '^[a-z0-9_.]{2,30}$');

create unique index profiles_tag_name_key
  on public.profiles (lower(tag_name))
  where tag_name <> '';

-- admin (i uživatel sám) ho smí měnit stejně jako jméno a avatar
grant update (tag_name) on public.profiles to authenticated;
