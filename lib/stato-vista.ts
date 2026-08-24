/**
 * IN CHE STATO È QUESTA VISTA — e «non lo so ancora» non è «non c'è».
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * Sette punti del sito disegnavano l'assenza di dati come se fosse un dato. Il caso che costa di
 * più: il carrello. `useState<CartItem[]>([])` parte vuoto, il carrello vero si legge dentro un
 * `useEffect` che React esegue DOPO il primo disegno, e il primo controllo del render è
 * `if (items.length === 0)`. Risultato: **l'HTML che parte dal server contiene «Il tuo carrello è
 * vuoto»**, col pulsante «Esplora i prodotti», a un cliente che il carrello ce l'ha pieno. Lo stesso
 * al checkout, dove quel ramo precede perfino il controllo di caricamento.
 *
 * Gli altri sei sono la stessa forma: la home che mentre carica mostra un negozio inventato con
 * prezzi inventati; le categorie che restano una griglia vuota sotto il loro titolo, per sempre se
 * la lettura fallisce; «Vicino a te» che su una lettura fallita scrive che a Piacenza non c'è
 * nessun negozio; le notifiche che a un errore di rete buttano la persona sulla pagina di accesso.
 *
 * ── La regola, ed è una sola ─────────────────────────────────────────────────────────────────
 * Gli stati sono TRE, non due: **carico · vuoto · rotto** (più «pieno», che è il caso normale).
 * «Vuoto» è un'affermazione sul mondo — *ho guardato e non c'è niente* — e non si può fare prima di
 * aver guardato. Qui non è che diventa improbabile: è irraggiungibile. `vuoto` esce solo con
 * `letto: true`, perché la funzione lo pretende.
 *
 * È la stessa distinzione che vale in tutta la casa fra ❌ e ⚪: un verde che non copre una parte
 * non è un verde su quella parte, e una lista che nessuno ha ancora letto non è una lista vuota.
 *
 * 🟢 Pura: nessuna rete, nessun React, nessun orologio. Una prova la ESEGUE.
 */

export type StatoVista = 'carico' | 'vuoto' | 'rotto' | 'pieno';

export interface VerdettoVista {
  stato: StatoVista;
  /** Perché siamo in questo stato: serve a chi legge il codice e a chi legge una prova rossa. */
  perche: string;
  /** Scorciatoie per il render, così nessuno riscrive il confronto a modo suo. */
  mostraScheletro: boolean;
  mostraVuoto: boolean;
  mostraErrore: boolean;
}

export interface DomandaVista {
  /** Qualcuno ha GIÀ guardato? Finché è false non si può dire niente sul mondo. */
  letto: boolean;
  /** La lettura è in corso adesso. */
  caricando?: boolean;
  /** La lettura è fallita. Un errore batte tutto: non si mostra «vuoto» su una lettura rotta. */
  errore?: unknown;
  /** Quanti elementi sono arrivati. */
  quanti?: number;
}

export function statoDellaVista(d: DomandaVista): VerdettoVista {
  const errore = d.errore !== undefined && d.errore !== null && d.errore !== false;

  // ① L'ERRORE BATTE TUTTO. Una lettura fallita non è un elenco vuoto: dirlo «vuoto» significa
  // dare per vera una cosa che nessuno ha potuto guardare. È il caso di «Vicino a te», che su una
  // lettura fallita scriveva che a Piacenza non c'è nessun negozio.
  if (errore) {
    return {
      stato: 'rotto',
      perche: 'la lettura è fallita: non sappiamo cosa c\'è, e dirlo «vuoto» sarebbe inventare',
      mostraScheletro: false,
      mostraVuoto: false,
      mostraErrore: true,
    };
  }

  // ② NON HO ANCORA GUARDATO. Il caso del carrello: lo stato parte da un array vuoto perché deve
  // pur partire da qualcosa, non perché il carrello sia vuoto.
  if (!d.letto || d.caricando) {
    return {
      stato: 'carico',
      perche: d.caricando ? 'la lettura è in corso' : 'nessuno ha ancora letto: «vuoto» sarebbe una risposta su una domanda mai fatta',
      mostraScheletro: true,
      mostraVuoto: false,
      mostraErrore: false,
    };
  }

  const quanti = Number.isFinite(Number(d.quanti)) ? Math.max(0, Math.trunc(Number(d.quanti))) : 0;

  // ③ HO GUARDATO E NON C'È NIENTE. Adesso «vuoto» è un'affermazione che possiamo sostenere.
  if (quanti === 0) {
    return {
      stato: 'vuoto',
      perche: 'letto, e non c\'è niente',
      mostraScheletro: false,
      mostraVuoto: true,
      mostraErrore: false,
    };
  }

  return { stato: 'pieno', perche: `letto, ${quanti} element${quanti === 1 ? 'o' : 'i'}`, mostraScheletro: false, mostraVuoto: false, mostraErrore: false };
}
