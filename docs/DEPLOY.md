# Nasazení Toggled — checklist

Pořadí je důležité: **nejdřív migrace, pak deploy**. Nový kód se dotazuje na
nové sloupce a tabulky — bez migrací by nástěnky po deployi spadly.

## 1. Migrace databáze (Supabase → SQL Editor)

Spustit po sobě, každou jen jednou (přeskoč ty, které už proběhly):

| Migrace | Co dělá |
| --- | --- |
| `0004_project_members.sql` | členství na projektech, zpřísnění RLS |
| `0005_priority_labels.sql` | priority karet, štítky |
| `0006_subtasks_recurrence.sql` | podúkoly, opakované karty |
| `0007_notifications.sql` | fronta notifikací + triggery |
| `0008_task_assignees.sql` | více řešitelů na kartě |
| `0009_notifications_inapp.sql` | in-app čtení notifikací (zvoneček) |
| `0010_avatars.sql` | avatary uživatelů, admin editace profilů |
| `0011_project_order.sql` | pořadí projektů nastavitelné adminem |

## 2. Env proměnné na hostingu

| Proměnná | Hodnota |
| --- | --- |
| `RESEND_API_KEY` | API klíč z resend.com |
| `CRON_SECRET` | libovolný silný náhodný řetězec |
| `EMAIL_FROM` | volitelné, default `Toggled <toggled@digitalized.cz>` |
| `NEXT_PUBLIC_APP_URL` | volitelné, default `https://toggled.digitalized.cz` |

(Stávající `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
a `SUPABASE_SERVICE_ROLE_KEY` zůstávají.)

## 3. Resend (e-maily)

1. Účet na https://resend.com, přidat doménu `digitalized.cz`.
2. Nastavit DNS záznamy, které Resend vypíše (MX + TXT/DKIM), počkat na ověření.
3. Vytvořit API klíč → `RESEND_API_KEY`.

## 4. Plánované odesílání (pg_cron v Supabase)

Repo záměrně nemá `vercel.json` — crony jedou z databáze, takže fungují na
jakémkoli hostingu i plánu. V Supabase: **Database → Extensions** zapnout
`pg_cron` a `pg_net`, potom v SQL Editoru (doplň svůj `CRON_SECRET`):

```sql
-- fronta notifikací (přiřazení, komentáře) — každých 10 minut
select cron.schedule(
  'toggled-notify', '*/10 * * * *',
  $$ select net.http_get(
       url := 'https://toggled.digitalized.cz/api/cron/notify',
       headers := '{"Authorization": "Bearer SEM_CRON_SECRET"}'::jsonb) $$
);

-- denní přehled termínů — po–pá 4:00 UTC (6:00 SELČ)
select cron.schedule(
  'toggled-digest', '0 4 * * 1-5',
  $$ select net.http_get(
       url := 'https://toggled.digitalized.cz/api/cron/digest',
       headers := '{"Authorization": "Bearer SEM_CRON_SECRET"}'::jsonb) $$
);
```

Kontrola: `select * from cron.job;` a ručně
`curl -H "Authorization: Bearer SEM_CRON_SECRET" https://toggled.digitalized.cz/api/cron/notify`
→ má vrátit JSON `{"processed":…,"sent":…}`.

## 5. Po nasazení ověřit

- nástěnka: filtr lišta nahoře, priorita/štítky/podúkoly v modalu karty
- zvoneček vedle timeru, obrazovka Notifikace
- přiřazení kolegy na kartu → zvoneček + (po cronu) e-mail
- Přehledy: rozklik osoby/projektu, přeřazení záznamu, export PDF výkazu
