# Toggled

Firemní úkolovník s měřením času (Todoist × Toggl). Next.js + Supabase + Vercel.
Koncept a rozhodnutí: [docs/CONCEPT.md](docs/CONCEPT.md).

## Lokální spuštění

1. **Supabase projekt** — založ na [supabase.com](https://supabase.com) (free tier stačí).
2. **Migrace** — v Supabase SQL Editoru spusť obsah
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   (nebo `supabase db push` přes Supabase CLI).
3. **Env** — zkopíruj `.env.example` → `.env.local` a doplň URL + klíče
   (Settings → API). `SUPABASE_SERVICE_ROLE_KEY` je tajný, jen pro server.
4. **E-mail šablona pozvánky** — v Supabase: Authentication → Email Templates →
   *Invite user* změň odkaz na:

   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
   ```

   a v Authentication → URL Configuration nastav Site URL (a případně Redirect URLs)
   na adresu aplikace.
5. **První super-admin** — zaregistruj si účet (Authentication → Users → Add user,
   nebo pozvánkou) a v SQL Editoru spusť:

   ```sql
   update profiles set is_super_admin = true where email = 'tvuj@email.cz';
   ```

6. **SMTP přes Resend (doporučeno)** — vestavěný Supabase e-mail má limit
   ~2 zprávy/hod. Na [resend.com](https://resend.com) ověř doménu (SPF + DKIM
   DNS záznamy) a vytvoř API klíč, pak v Supabase Settings → Authentication →
   SMTP Settings zapni Custom SMTP: host `smtp.resend.com`, port `465`,
   username `resend`, password = API klíč, sender z ověřené domény.
   Žádná změna v kódu ani env appky není potřeba.
7. `npm install && npm run dev` → http://localhost:3000

## Jak se to používá

- **Super-admin** na `/admin` zakládá workspaces (firmy) a v každém workspace na
  záložce *Členové* zve lidi a jmenuje adminy.
- **Admin** spravuje projekty a členy svého workspace a vidí *Přehledy* (hodiny
  po lidech a projektech za období).
- **Member** vidí úkoly (Moje / Všechny), quick-add úkolu, u úkolu spouští timer
  (▶) nebo zapíše čas ručně na záložce *Můj čas*. Hotový úkol odškrtne.
- Čas se váže vždy na úkol; projekt se dědí z úkolu. Běží max. jeden timer
  na uživatele (start dalšího předchozí zastaví).

## Deploy na Vercel

1. Pushni repo na GitHub a naimportuj do Vercelu.
2. Nastav env proměnné z `.env.example` (`NEXT_PUBLIC_SITE_URL` = produkční doména).
3. V Supabase přidej produkční doménu do Authentication → URL Configuration.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase: Postgres + RLS (multi-tenant izolace), Auth (e-mail + heslo, pozvánky)
- Role: `member` / `admin` per workspace, `is_super_admin` globálně
