/**
 * 16/10/2026 — LA FOTO DEI CONTANTI NON PUO' FERMARE UNA CONSEGNA.
 *
 * Dal lotto R33, sulle consegne in contanti il codice del cliente si chiede
 * DOPO l'incasso: finche' l'incasso non e' dichiarato la pagina mostra solo
 * «Conferma incasso contanti», e il database risponde CASH_NOT_CONFIRMED al
 * codice (migrazione 163). Da quel momento ogni rifiuto della conferma
 * dell'incasso e' una consegna che non si chiude.
 *
 * E i rifiuti c'erano, tutti e due legati alla foto:
 *  · sotto i 50 euro la foto era facoltativa, ma senza foto il pannello mandava
 *    `"photoUrl": null` e la rotta accettava solo «testo oppure niente»: 400
 *    «Dati non validi» su qualunque importo;
 *  · da 50 euro in su la foto (o la firma, che il pannello non chiede nemmeno)
 *    era obbligatoria: con la fotocamera rotta, il permesso negato o un telefono
 *    vecchio non c'era nessuna strada.
 *
 * La regola, in un posto solo per il pannello e per la rotta:
 *  · sotto la soglia la prova non serve;
 *  · dalla soglia in su serve la foto dei contanti (o la firma). Chi non puo'
 *    farla scrive il perche' in una nota: l'incasso si registra, e gli
 *    amministratori ricevono un avviso con la nota. Il fattorino non resta
 *    fermo alla porta, e un incasso grosso senza foto non passa in silenzio.
 *
 * 🟢 Pura: niente rete, niente orologio. Le prove la eseguono.
 */

/** Dal contante da rimettere in su (centesimi) serve una prova: 50 euro. */
export const SOGLIA_PROVA_INCASSO_CENTS = 5000;

/** Quanto deve essere lunga, almeno, la nota di chi non riesce a fare la foto. */
export const NOTA_SENZA_FOTO_MIN = 10;
/** Il tetto della nota, uguale nel pannello e nella rotta. */
export const NOTA_SENZA_FOTO_MAX = 300;

export const MESSAGGIO_SERVE_LA_PROVA =
  'Da 50 € in su serve la foto dei contanti. Se non riesci a farla, scrivi nella nota il perché (almeno 10 lettere).';

/** Vero quando, per questo contante da rimettere, serve una prova dell'incasso. */
export function serveUnaProva(contanteDaRimettereCents: number): boolean {
  return contanteDaRimettereCents >= SOGLIA_PROVA_INCASSO_CENTS;
}

export type ProvaIncasso = {
  foto?: string | null;
  firma?: string | null;
  nota?: string | null;
};

export type EsitoProva =
  /** `senzaFoto`: la soglia chiedeva una prova ed e' arrivata solo la nota — va avvisato chi amministra. */
  | { ok: true; senzaFoto: boolean; nota: string | null }
  | { ok: false; messaggio: string };

/** Se l'incasso si puo' registrare con la prova che c'e', e se serve avvisare. */
export function valutaProvaIncasso(contanteDaRimettereCents: number, prova: ProvaIncasso): EsitoProva {
  const nota = (prova.nota ?? '').trim();
  if (!serveUnaProva(contanteDaRimettereCents)) return { ok: true, senzaFoto: false, nota: null };
  if (prova.foto || prova.firma) return { ok: true, senzaFoto: false, nota: null };
  if (nota.length >= NOTA_SENZA_FOTO_MIN) return { ok: true, senzaFoto: true, nota };
  return { ok: false, messaggio: MESSAGGIO_SERVE_LA_PROVA };
}

/** Quello che il pannello ha in mano quando il fattorino preme «Conferma». */
export type DatiDelPannello = {
  orderId: string;
  /** Il testo del campo importo, in euro col punto («7.00»). */
  importo: string;
  contanteDaRimettereCents: number;
  fotoContanti: string | null;
  fotoConsegna: string | null;
  nota: string;
};

/**
 * Il corpo della richiesta a `/api/rider/cash-confirm`.
 *
 * Un campo che non c'e' NON parte: niente `null` nel corpo. La rotta li tollera
 * (le versioni gia' nei telefoni li mandano ancora), ma il pannello non deve
 * dipenderne.
 */
export function corpoDellaConferma(
  d: DatiDelPannello,
): { ok: true; corpo: Record<string, string | number> } | { ok: false; messaggio: string } {
  const cents = Math.round(parseFloat(d.importo) * 100);
  if (Number.isNaN(cents) || cents < 0) return { ok: false, messaggio: 'Importo non valido' };
  const esito = valutaProvaIncasso(d.contanteDaRimettereCents, { foto: d.fotoContanti, nota: d.nota });
  if (!esito.ok) return esito;
  const corpo: Record<string, string | number> = { orderId: d.orderId, cashCollectedCents: cents };
  if (d.fotoContanti) corpo.photoUrl = d.fotoContanti;
  if (d.fotoConsegna) corpo.deliveryPhotoUrl = d.fotoConsegna;
  if (esito.senzaFoto && esito.nota) corpo.nota = esito.nota;
  return { ok: true, corpo };
}
