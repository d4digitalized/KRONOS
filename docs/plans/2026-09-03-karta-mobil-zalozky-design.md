# Karta úkolu na mobilu: záložky Úkol / Komentáře

Datum: 2026-09-03 · stav: schváleno

## Problém

Na mobilu (< 640 px) se karta roztáhne na celou výšku, panel komentářů si
dole vezme svou přirozenou výšku a pole úkolu se posouvají v malém vnořeném
okně nad ním (obsah useknutý u „Plán:“). Pole jsou v `flex-wrap` řádcích
s malými vstupy, název je jednořádkový input a dlouhý titul se usekne.

## Rozhodnutí

Zvažované přístupy: jedna dlouhá stránka, záložky, sbalitelné sekce.
Zvoleny **záložky Úkol / Komentáře** — komentáře mají na mobilu celou výšku
s psaním nahoře (jako dnes na desktopu), úkol má svůj plynulý scroll.
Desktop (≥ 640 px) zůstává beze změny: oba sloupce vedle sebe.

## Návrh

**Hlavička** — beze změny (projekt, autosave stav, sdílet, zavřít).
Pod ní na mobilu přepínač záložek `Úkol` / `Komentáře (N)`; u Komentářů
tečka, když od otevření karty přibyl komentář a záložka není aktivní.
Výchozí záložka Úkol.

**Záložka Úkol** — obsah se posouvá mezi hlavičkou a dolní lištou.
- Název: `textarea` auto-výška (1–3 řádky), místo jednořádkového inputu.
- Pole v řádcích `popisek | hodnota`: Řešitel, Vedoucí, Čekám na, Termín,
  Priorita, Opakování, Plán. Popisek pevná šířka, hodnota zbytek; vstupy
  datum/select/time na plnou šířku, výška ≈ 40 px pro dotyk.
- Spustit timer na plnou šířku, pod ním štítky.
- Podúkoly, checklisty, přílohy beze změny pořadí.

**Záložka Komentáře** — formulář nahoře přilepený, vlákno v celé zbylé
výšce; zmínky, mazání a aktivita beze změny.

**Dolní lišta** — Smazat kartu / Hotovo přilepené dole (`pb-safe`).

## Implementace

Jen `src/components/CardModal.tsx`, Tailwind třídy:
1. Stav `mobileTab: "task" | "comments"` + `seenCommentCount` pro tečku.
2. Přepínač záložek pod hlavičkou (`sm:hidden`).
3. Levý sloupec: `hidden sm:flex` když je aktivní záložka Komentáře,
   pravý sloupec naopak; na `sm+` oba vždy viditelné.
4. Řádky polí: mobilní `grid grid-cols-[6rem_1fr]`, na `sm+` původní
   `flex flex-wrap`. Vstupy `h-10 w-full sm:h-auto sm:w-auto`.
5. Název jako `textarea rows=1` s auto-výškou.

Ověření: build; ruční kontrola na telefonu (přepínání záložek, psaní
komentáře, autosave polí, zavření).
