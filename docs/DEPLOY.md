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
| `0012_backlog.sql` | výchozí sloupec Backlog, karty bez sloupce do něj |
| `0013_tag_name.sql` | tag name (@handle) uživatele, nastavuje admin |
| `0014_mentions.sql` | @zmínky v komentářích → notifikace |
| `0015_api_tokens.sql` | osobní API tokeny pro MCP server (napojení do Clauda) |
| `0016_oauth.sql` | OAuth server pro MCP (custom connector ve webovém/mobilním Claudovi) |

## 2. Env proměnné na hostingu

| Proměnná | Hodnota |
| --- | --- |
| `RESEND_API_KEY` | API klíč z resend.com |
| `CRON_SECRET` | libovolný silný náhodný řetězec |
| `EMAIL_FROM` | volitelné, default `Toggled <toggled@digitalized.cz>` |
| `NEXT_PUBLIC_APP_URL` | volitelné, default `https://toggled.digitalized.cz` |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Settings → JWT Secret. Podpis tokenů pro MCP server. Jen server, NIKDY `NEXT_PUBLIC_`. |

(Stávající `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
a `SUPABASE_SERVICE_ROLE_KEY` zůstávají.)

## 3. Resend (e-maily)

1. Účet na https://resend.com, přidat doménu `digitalized.cz`.
2. Nastavit DNS záznamy, které Resend vypíše (MX + TXT/DKIM), počkat na ověření.
3. Vytvořit API klíč → `RESEND_API_KEY`.

## 4. Odesílání e-mailů — bez nastavování v Supabase

E-maily odesílá aplikace sama, okamžitě po akci: klient po komentáři /
přiřazení / dokončení karty zavolá `/api/notify/run` (autorizace
přihlášením), server vyprázdní frontu přes Resend. Řádky fronty se
atomicky zamlouvají, souběh ani opakované volání nevadí. **V Supabase
není potřeba pg_cron, pg_net ani žádný trigger na odesílání.**

Stačí env `RESEND_API_KEY` na hostingu (krok 2). `CRON_SECRET` slouží už
jen pro podpis Reply-To tokenů a ruční vyvolání
(`curl -H "Authorization: Bearer …" …/api/cron/notify`).

Pokud jsi dřív založil cron joby / trigger podle starší verze tohoto
návodu, ukliď je:

```sql
drop trigger if exists on_notification_email on public.notifications;
drop function if exists public.notify_email_push();
select cron.unschedule('toggled-notify')
  where exists (select 1 from cron.job where jobname = 'toggled-notify');
select cron.unschedule('toggled-digest')
  where exists (select 1 from cron.job where jobname = 'toggled-digest');
```

Volitelný ranní digest termínů (jediné, co ze své podstaty potřebuje
plánovač) lze kdykoli později zapnout přes pg_cron + `/api/cron/digest`.

## 5. Odpovědi na e-maily → komentář na kartě (Resend inbound)

Volitelné; bez nastavení všechno ostatní funguje, jen e-maily nemají
Reply-To. Postup:

1. Resend → **Domains → Add domain**, zvol subdoménu pro příjem,
   např. `reply.digitalized.cz`, typ *receiving* — Resend vypíše MX
   záznam, přidej ho do DNS.
2. Resend → **Webhooks → Add webhook**: URL
   `https://toggled.digitalized.cz/api/inbound`, event `email.received`.
   Zkopíruj **signing secret** (`whsec_…`).
3. Env na hostingu (Production + redeploy):
   - `REPLY_DOMAIN` = `reply.digitalized.cz`
   - `RESEND_WEBHOOK_SECRET` = `whsec_…`

Notifikační e-maily pak mají Reply-To s podepsaným tokenem
(`reply+<task>.<user>.<podpis>@reply.digitalized.cz`); odpověď se po
ověření podpisu a členství vloží jako komentář (citace původní zprávy
se odřízne) a normálně notifikuje ostatní.

## 6. Po nasazení ověřit

- nástěnka: filtr lišta nahoře, priorita/štítky/podúkoly v modalu karty
- zvoneček vedle timeru, obrazovka Notifikace
- přiřazení kolegy na kartu → zvoneček + (po cronu) e-mail
- Přehledy: rozklik osoby/projektu, přeřazení záznamu, export PDF výkazu
