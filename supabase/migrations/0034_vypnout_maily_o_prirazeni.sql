-- E-maily o přiřazení karty („assigned") se ve výchozím stavu neposílají:
-- v aplikaci je zvoneček a přehledy, mail navíc jen otravoval. Vypínáme je
-- všem stávajícím i novým uživatelům; kdo o ně stojí, zapne si je zpět
-- v Nastavení → Notifikace. Komentáře, zmínky a denní přehled beze změny.

alter table public.notification_prefs
  alter column on_assign set default false;

update public.notification_prefs set on_assign = false where on_assign;
