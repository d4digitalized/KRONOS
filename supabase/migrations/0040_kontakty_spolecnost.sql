-- Společnost kontaktu ("ducha") — sjednocení s Tektos adresářem,
-- kde se zobrazuje jako prefix „Firma | Jméno/nick".
alter table public.contacts
  add column company text not null default '';
