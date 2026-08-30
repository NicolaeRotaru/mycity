/**
 * L'IDENTITÀ DI UNA RIGA IN UN ELENCO CHE SI PUÒ MODIFICARE.
 *
 * 27/8/2026 (R101) — nel costruttore della home gli elenchi modificabili (i «Vantaggi», le
 * «Immagini» della galleria) usavano la POSIZIONE come identità della riga: `key={i}`. Ma il
 * cestino cancella dal mezzo, e allora la riga 3 diventa la 2: per React è la stessa riga che ha
 * cambiato contenuto, non una riga diversa. I campi di testo si riallineano da soli perché il loro
 * valore arriva da fuori — ma lo stato che i sotto-componenti tengono DENTRO no: l'indicatore
 * «Caricamento…» di `ImageUrlField` resta agganciato al nodo riusato e salta sulla riga sbagliata.
 *
 * È danno contenuto (pannello interno), ma è la classe di errore che finisce con l'immagine
 * sbagliata pubblicata in home.
 *
 * Le righe salvate non hanno un identificativo, e non possiamo dargliene uno: la loro forma la
 * decide lo schema in `lib/home-site.ts`, che appartiene a un altro lotto e scarterebbe i campi che
 * non conosce. Quindi l'identità sta qui, appesa all'OGGETTO riga: finché l'oggetto vive, la sua
 * chiave è la stessa; quando una modifica ne crea uno nuovo, la chiave si eredita.
 *
 * 🟢 Pura: nessun React. Una prova la ESEGUE.
 */

const chiavi = new WeakMap<object, string>();
let contatore = 0;

/** La chiave stabile di questa riga. Alla prima domanda gliene viene assegnata una. */
export function chiaveDiRiga(riga: object): string {
  const gia = chiavi.get(riga);
  if (gia) return gia;
  contatore += 1;
  const nuova = `riga-${contatore}`;
  chiavi.set(riga, nuova);
  return nuova;
}

/**
 * Modificare una riga significa creare un oggetto nuovo (lo stato non si tocca sul posto): la
 * chiave passa da quello vecchio a quello nuovo, altrimenti ogni lettera battuta smonterebbe e
 * rimonterebbe la riga, e il cursore uscirebbe dal campo.
 */
export function conChiaveEreditata<T extends object>(vecchia: object, nuova: T): T {
  chiavi.set(nuova, chiaveDiRiga(vecchia));
  return nuova;
}
