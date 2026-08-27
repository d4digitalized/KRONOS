-- Denní výkaz v procentech: podrežim „Jen měření času". Člen nevykazuje
-- timerem ani ručními záznamy, ale procenty na projekty (8h den) — aplikace
-- z nich vygeneruje běžné time_entries bloky od 8:00, takže Přehledy a
-- výkazy fungují beze změny. Flag zapíná admin; zahrnuje osekané rozhraní
-- (jen Report) a schovává timer, aby se ruční záznamy nemíchaly s výkazem.

alter table public.workspace_members
  add column percent_report boolean not null default false;
