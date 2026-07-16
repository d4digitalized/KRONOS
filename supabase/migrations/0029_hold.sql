-- Hold: uspaná karta. Přetažením do automatického sloupce Hold na nástěnce
-- karta „spí" — je vidět jen na nástěnce projektu, neukazuje se v Task force
-- ani v Moje úkoly (a nechodí na ni denní digest). Přetažením ven se probudí.

alter table public.tasks
  add column on_hold boolean not null default false;
