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

/**
 * 29/10/2026 — GLI ORDINI PORTANO IL SEGNO DELLA CHIAVE CHE LI HA FATTI NASCERE.
 *
 * Sulla chiave abbandonata la rotta dei contanti deve sapere se gli ordini di
 * QUEL tentativo sono gia' nati. La riga della chiave lo dice solo se la sua
 * scrittura finale e' passata; quando non passa, si cercavano «gli ordini in
 * contanti di questa persona dopo l'ora della chiave»: cosi' l'ordine di
 * un'altra scheda o di un altro telefono veniva preso per questo carrello, la
 * cassa diceva «fatto» e l'ordine di adesso non nasceva.
 *
 * Il legame vero non chiede colonne nuove: l'identificativo di ogni ordine
 * nasce dalla chiave stessa (persona + chiave + posizione del negozio nel
 * carrello, passate in SHA-256). Chi rilegge sa esattamente quali ordini
 * cercare, e il database stesso rifiuta un secondo ordine con lo stesso
 * identificativo (chiave primaria): il doppione non puo' nascere nemmeno se
 * tutti gli altri controlli cadono.
 *
 * Usa `crypto.subtle` del runtime, senza import: la pagina della cassa importa
 * questo file per `laChiaveVaButtata` e non deve portarsi dietro il crypto di Node.
 */
export async function idOrdiniDelTentativo(chiave: string, utente: string, quanti: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < quanti; i++) {
    const impronta = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mycity:cod:${utente}:${chiave}:${i}`)),
    );
    const b = Array.from(impronta.slice(0, 16));
    b[6] = (b[6] & 0x0f) | 0x50; // forma di un UUID versione 5
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
    ids.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
  return ids;
}
