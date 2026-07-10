# Toggled — Delegované úkoly (follow-up / „čekám na")

*Brainstorming 2026-07-10.*

## Pitch

Když zadám úkol jinému člověku („Martine, udělej studii"), moje práce zadáním
nekončí — potřebuji **sledovat, že se věc opravdu dodala**. Úkol dostane stav
**„čekám na X"** (X = člen workspace, nebo externí kontakt bez účtu) a sbírá se
na samostatné stránce **Delegované**, dokud není splněný. Žádné automatické
urgence — jen spolehlivý přehled „co jsem komu zadal a ještě to není".

## Rozhodnutí z brainstormingu

1. **Follow-up = přehled**, ne notifikace. Systém eviduje, uživatel si urguje sám.
2. **Externisté = kontakty.** Jen jméno/e-mail v adresáři sdíleném za workspace;
   se systémem nijak neinteragují, stav úkolu mění zadavatel.
3. **Jeden úkol, dva stavy.** Úkol se zadáním nezavírá — přejde do čekání a
   zavře se až dodáním (stávající `completed_at`). Žádný duplicitní follow-up úkol.
4. **Nezávislé na přiřazení.** Čekání se nastavuje tlačítkem na kartě, ať je úkol
   přiřazený komukoli. U interního člověka se typicky kombinuje s přiřazením,
   u externisty se vybere kontakt.
5. **Jedno čekání na úkol.** Hlídá ten, kdo follow-up nastavil. (Per-user
   follow-upy víc lidí najednou = v2, schéma na to nechává dveře.)
6. **Čekající úkol zmizí z Moje úkoly** (tomu, kdo čekání nastavil) — denní
   seznam zůstane čistý, čekání žije jen na stránce Delegované.

## Názvosloví

- Koncept se v GTD jmenuje **„Waiting For"**; interně `waiting_for` / follow-up.
- UI česky: tlačítko na kartě **„Čekám na…"**, stránka v navigaci **„Delegované"**.

## Core loop

1. Na kartě úkolu kliknu **„Čekám na…"** a vyberu člena workspace, nebo kontakt
   z adresáře (případně nový kontakt rovnou založím).
2. Úkol se přesune z Moje úkoly na stránku **Delegované**: vidím na koho čekám,
   **jak dlouho už** („čeká 12 dní") a termín úkolu.
3. Když dotyčný dodá: interní člen si úkol odškrtne sám, u externisty ho
   odškrtnu já. Úkol zmizí z Delegovaných.
4. Čekání jde kdykoli zrušit (úkol se vrátí do Moje úkoly) nebo přepnout na
   jiného člověka.

## Scope

### MVP
- **Adresář kontaktů** za workspace: jméno + volitelný e-mail + poznámka;
  správa jako nová sekce na stránce Členové (založit jde i z výběru „Čekám na…").
- **Tlačítko „Čekám na…"** v detailu karty: výběr člen/kontakt, uloží se odkdy
  a kdo čekání nastavil; zrušení tamtéž.
- **Stránka Delegované**: otevřené úkoly s mým čekáním, řazené po termínu;
  u každého jméno čekaného, délka čekání, projekt, termín; odškrtnutí přímo
  ze seznamu (jako v Moje úkoly).
- **Moje úkoly** nezobrazují úkoly, kde jsem nastavil čekání.
- Štítek „čeká na X" viditelný na kartě na nástěnce i v detailu.

### v2
- Připomínka mně („čeká už 14 dní bez pohybu") — návazně na `notifications`.
- Per-user follow-upy (víc lidí sleduje tentýž úkol nezávisle).
- E-mailová urgence externistovi; magic link, přes který externista úkol
  vidí a označí hotovo (bez účtu).
- Dvoufázové dokončení: „dodáno" → „přijato zadavatelem".
- Počítadlo čekajících v navigaci.

### Non-goals (maybe never)
- Plnohodnotné účty pro externisty; externisté jako řešitelé (`task_assignees`).

## Datový model a klíčová rozhodnutí

| Rozhodnutí | Volba | Proč |
|---|---|---|
| Kontakty | Nová tabulka `contacts` (`workspace_id`, `name`, `email?`, `note?`, `created_by`) | Sdílené za workspace, žádná vazba na `auth.users` |
| Čekání | Nová tabulka `task_followups`: `task_id` UNIQUE, `waiting_user_id?`, `waiting_contact_id?`, `created_by`, `created_at`; CHECK právě jeden z user/contact | Oddělená tabulka místo sloupců na `tasks` — UNIQUE dnes vynutí „jedno na úkol", pro v2 stačí unikátnost povolit per-user |
| Konec čekání | Řádek se smaže (zrušení) nebo úkol dostane `completed_at` | Žádný nový stavový stroj; Delegované = join followups × otevřené úkoly |
| Moje úkoly | Vyloučit úkoly, kde existuje můj followup | Rozhodnutí „přesune se do Delegovaných" |
| RLS | Kontakty čtou/zakládají členové workspace; followupy dle viditelnosti úkolu | Kopíruje stávající vzor `project_members`/admin |
| Migrace | Ručně přes Supabase SQL editor | Stávající deploy workflow projektu |

## Rizika

1. **„Přehled bez připomínek" nemusí stačit** — nejrizikovější předpoklad.
   Levný test: 2 týdny reálného používání; pokud se na Delegované zapomíná,
   přidat v2 připomínku nebo badge v navigaci.
2. **Zmizení z Moje úkoly** může vést ke ztrátě věcí z dohledu, když si člověk
   nezvykne chodit na Delegované. Souvisí s bodem 1; sledovat při testu.
3. **Duplicitní kontakty** (Martin vs. M. Novák) — MVP neřeší, jen našeptávač
   při zakládání.

## Otevřené otázky

- Vidí stránku Delegované i admin za ostatní (kdo na koho čeká napříč firmou)?
  MVP: ne, každý jen svoje.
- Má se čekání zapisovat do `task_activity` („X nastavil čekání na Y")? Levné,
  nejspíš ano.
- ~~Umístění správy kontaktů~~ → rozhodnuto: nová sekce na stránce Členové.
