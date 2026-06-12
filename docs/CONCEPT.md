# Toggled — koncept

*Výstup brainstormingu 2026-06-12, druhé kolo škrtání tamtéž.*

## Pitch

Firemní úkolovník s měřením času (Todoist × Toggl) pro vlastní firmy: lidé mají v projektech úkoly (titulek, popis, přiřazení, termín) a u úkolu spouští timer nebo zapisují čas ručně. Admini (společníci/manažeři) vidí přehledy hodin po lidech a projektech. Vlastní data, žádné předplatné.

> Změna 2026-06-12 (3. kolo): úkoly se přesunuly z v2 do MVP — časovač je vázaný na úkol, ve stylu Todoistu.

## Pro koho a proč

- **Uživatelé (members):** zaměstnanci/spolupracovníci vlastních firem (každá firma = workspace). Jeden uživatel může být ve více firmách zároveň — v UI přepínač workspace.
- **Admini (manažeři):** vidí a spravují dění ve svém workspace; více adminů na workspace.
- **Super-admin:** spravuje aplikaci kompletně — zakládá workspaces (firmy), jmenuje adminy a nastavuje jim možnosti. Workspace nejde založit svépomocí, jen super-adminem.
- **Motivace stavět vlastní:** kontrola nad daty a rozšiřováním (budoucí úkoly), cena existujících nástrojů.

## Core loop

1. Uživatel se přihlásí, (případně přepne workspace) a vidí seznam úkolů — svoje nahoře. Ad-hoc práce = quick-add úkolu (jako v Todoistu).
2. U úkolu **spustí timer** (play) — nebo zapíše čas ručně/zpětně. Timer zastaví, záznam (kdo, úkol, start–konec) se uloží; projekt se dědí z úkolu. Hotový úkol odškrtne.
3. Admin se kdykoli podívá na přehled: hodiny po lidech a po projektech za zvolené období.

## Scope

### MVP
- Workspaces (multi-tenant, jedna instance); zakládá je super-admin
- Role: **member** (trackuje svůj čas, vidí své záznamy), **admin** (správa členů a projektů, vidí vše ve workspace), **super-admin** (správa celé aplikace: workspaces, admini)
- Členství: uživatel může být ve více workspacích, přepínač v UI
- Pozvánky e-mailem
- Projekty (CRUD, archivace)
- **Úkoly** (Todoist-style): titulek, popis, projekt, přiřazení na člověka, termín, odškrtnutí; quick-add; zakládat může každý člen; pohled „Moje úkoly" / vše
- Time entry: člověk, **úkol (povinný — projekt se dědí z úkolu)**, start–konec; živý timer u úkolu + ruční zápis a editace zpětně
- Přehledy pro adminy: **hodiny** po lidech a po projektech, filtr období
- Responzivní web (timer funguje i na telefonu v prohlížeči), UI česky, bez i18n

### v2
- Podúkoly, řazení/sekce v projektu, komentáře k úkolům
- Sazby a peníze v přehledech (hodiny × sazba) — zatím Excel nad exportem
- Agregovaný dashboard super-admina napříč firmami
- CSV export (levný, vysoká hodnota — kandidát na rychlé doplnění)
- Role viewer/manager, jemnější oprávnění adminů
- Offline režim timeru

### Non-goals (maybe never)
- Tagy (kategorizaci pokrývají projekty a úkoly)
- Záznam času bez úkolu (ad-hoc = quick-add úkolu)
- Nativní mobilní appka
- Fakturace přímo v appce, měny a kurzové přepočty
- Veřejný SaaS provoz, billing, onboarding cizích firem

## Stack a klíčová rozhodnutí

| Rozhodnutí | Volba | Proč |
|---|---|---|
| Framework | Next.js (App Router) na Vercelu | Preferovaný stack, zero-ops hosting |
| DB + Auth | Supabase (Postgres + Supabase Auth) | Multi-tenant přes RLS, pozvánky a e-mail+heslo out-of-the-box |
| Tenancy | Workspace = firma; členství v tabulce `workspace_members` (user × workspace × role) | Jeden deploy pro všechny firmy, izolace přes RLS; více firem na uživatele zdarma |
| Super-admin | Flag na profilu uživatele; RLS politiky ho propouští všude; jen on zakládá workspaces | Centrální správa appky, žádný self-serve |
| Auth | E-mail + heslo, pozvánky od admina | Denně používaný nástroj — magic link by otravoval |
| Úkoly v core | `time_entries.task_id` povinný FK; projekt záznamu se dědí z úkolu | Jeden mentální model (Todoist-style), čistší reporty |

## Rizika

1. **Scope creep** — největší riziko je nedotáhnout MVP. Druhé kolo škrtání vyhodilo celé peníze (sazby, měny, Kč v přehledech). Obrana: v2 seznam je závazný, nic z něj se nepředbíhá.
2. **Úkoly nafukují MVP** — přesun úkolů do MVP (3. kolo) zvětšil záběr; obrana: úkol je záměrně plochý (žádné podúkoly, sekce, komentáře — vše v2).
3. **RLS s třemi úrovněmi přístupu** (member / admin / super-admin napříč workspaces) — nejsložitější technický kus MVP; navrhnout a otestovat politiky jako první.
4. **Adopce ve firmě** — nástroj žije a umírá s tím, jestli ho lidé reálně používají. Nejlevnější test: nasadit nejdřív jen pro jednu firmu/pár lidí na 2 týdny, pak teprve rozšířit.

## Otevřené otázky

- Kolik lidí celkem bude nástroj používat? (ovlivňuje, jestli Supabase free tier stačí — pravděpodobně ano)
- Mají členové vidět záznamy kolegů na společném projektu, nebo striktně jen své? (MVP: jen své; admin vidí vše)
- Co přesně znamená „dávat možnosti adminům" — jaká oprávnění se mají dát zapínat/vypínat? (MVP: admin má fixní sadu práv; konfigurovatelnost až podle reálné potřeby)
- Pojmenování produktu — pracovně „Toggled".
