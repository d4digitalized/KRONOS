export const CONFIRM_EVENT = "toggled:confirm";

export type ConfirmOptions = {
  /** Nadpis dialogu. Výchozí „Opravdu?". */
  title?: string;
  /** Hlavní text s vysvětlením, co se stane. */
  message: string;
  /** Popisek potvrzovacího tlačítka. Výchozí „Smazat". */
  confirmLabel?: string;
  /** Popisek zrušení. Výchozí „Zrušit". */
  cancelLabel?: string;
  /** Vizuálně odliší nevratnou/destruktivní akci (červené tlačítko). */
  danger?: boolean;
};

export type ConfirmDetail = ConfirmOptions & { resolve: (ok: boolean) => void };

/** Vlastní potvrzovací dialog místo window.confirm. Vrací příslib s true/false. */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ConfirmDetail>(CONFIRM_EVENT, {
        detail: { ...opts, resolve },
      })
    );
  });
}
