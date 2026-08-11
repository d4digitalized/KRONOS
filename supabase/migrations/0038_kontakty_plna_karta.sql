-- Sjednocení karty kontaktu s Tektos adresářem: kontakt ("duch") nese
-- plnou vizitku — telefon, tituly, kategorie. Tektos je propisuje
-- obousměrně (Kronos = zdroj pravdy, neprázdná hodnota vyhrává).
alter table public.contacts
  add column phone text not null default '',
  add column title_before text not null default '',
  add column title_after text not null default '',
  add column categories text[] not null default '{}';
