/**
 * 27/8/2026 (R133) — LA CHIAVE DEL TENTATIVO DOPO UN ERRORE.
 *
 * Il browser tiene una chiave per tentativo di ordine in contanti e la butta
 * solo quando l'ordine riesce (`chiudiTentativo` in `onSuccess`). Dopo un
 * errore la teneva: il tentativo successivo ripartiva con la stessa chiave e,
 * finché il server non l'ha liberata, si sentiva rispondere «Ordine gia in
 * corso, attendi qualche secondo» — su un ordine che non esiste.
 *
 * La regola ha UNA eccezione, ed è quella che conta: se il server dice che c'è
 * davvero un invio gemello in corso (`inCorso`), la chiave è di quello. Chi la
 * butta lì crea il doppione che tutta questa storia serve a evitare: due
 * ordini, due riserve di merce, il credito tolto due volte.
 *
 * 🟢 Pura: decide su un oggetto, non tocca niente. Una prova la ESEGUE.
 */
export function laChiaveVaButtata(rispostaDelServer: unknown): boolean {
  const corpo = (rispostaDelServer ?? {}) as { inCorso?: unknown };
  return corpo.inCorso !== true;
}
