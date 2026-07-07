/** Po akci, která může založit notifikace (komentář, přiřazení, dokončení
    karty), řekne serveru, ať hned odešle e-maily. Fire-and-forget —
    UI na výsledek nečeká, případná chyba se dořeší při další akci. */
export function pingNotifyEmails() {
  fetch("/api/notify/run", { method: "POST" }).catch(() => {});
}
