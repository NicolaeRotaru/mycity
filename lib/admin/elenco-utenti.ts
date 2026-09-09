/**
 * 8/9/2026 — L'ELENCO UTENTI SI FERMAVA A CINQUECENTO E CHIAMAVA QUEI
 * CINQUECENTO «RISULTATI».
 *
 * ── Come si era rotto ───────────────────────────────────────────────────────
 * La pagina /admin/users scarica i cinquecento profili più recenti (un tetto
 * messo apposta: prima li leggeva tutti a ogni apertura). Poi filtrava e
 * cercava DENTRO quei cinquecento, e sotto il titolo scriveva il numero di
 * righe che aveva in mano: `${filtered.length} risultati`.
 *
 * Tre danni in fila, tutti dallo stesso gesto — chiamare «tutto» quello che si
 * ha in mano:
 *   ① dal cinquecentunesimo iscritto in poi la pagina avrebbe scritto per
 *      sempre «500 risultati», qualunque fosse il numero vero;
 *   ② cercare per nome o email un cliente iscritto sei mesi prima non dava
 *      «non è fra i più recenti»: dava ZERO RIGHE. Chi guarda conclude che
 *      quella persona non esiste — e magari sta rispondendo a una richiesta di
 *      cancellazione dati, dove «non esiste» è una risposta sbagliata che si
 *      paga in sanzione;
 *   ③ il file CSV degli utenti ereditava il tetto senza dirlo.
 *
 * ── La cura, in tre pezzi ───────────────────────────────────────────────────
 * ① Il numero vero arriva dal database (`count`), non dalla lunghezza
 *    dell'elenco in memoria. Quando non si riesce a contare, la pagina lo dice:
 *    «non ho potuto contare», che non è zero e non è un numero inventato.
 * ② La ricerca esce dal tetto: quando si scrive nella casella, la domanda va al
 *    database su TUTTI i profili. Se quella lettura non riesce, si ripiega sui
 *    profili già scaricati — ma allora la pagina dichiara che sta guardando in
 *    un pezzo solo, invece di far finta di aver guardato ovunque.
 * ③ Le tre scritte che devono restare d'accordo — sottotitolo, avviso e
 *    messaggio di elenco vuoto — escono TUTTE da questa funzione sola. Non c'è
 *    modo di cambiarne una e dimenticare le altre due: è la stessa lezione di
 *    `lib/letture-cruscotto.ts`, dove la finestra esce insieme al numero.
 *
 * Qui dentro non c'è niente di Supabase e niente di React: sono conti e frasi,
 * quindi una prova li può ESEGUIRE senza database e senza browser.
 */

/** Quante righe si porta in casa il pannello a ogni apertura. */
export const TETTO_UTENTI = 500;

/** Quanti risultati al massimo torna la ricerca sul database. */
export const TETTO_RISULTATI_RICERCA = 200;

/** Da quante lettere in poi vale la pena disturbare il database. */
export const LETTERE_MINIME_RICERCA = 2;

/**
 * Dove ha guardato davvero l'elenco che si sta vedendo.
 * - `nessuna`      → nessuna ricerca in corso: si vedono i più recenti.
 * - `in-corso`     → la domanda al database è partita, la risposta non c'è ancora.
 * - `server`       → ha risposto il database: la ricerca ha guardato TUTTI gli utenti.
 * - `solo-caricati`→ il database non ha risposto: si cerca nei profili in memoria.
 */
export type AmbitoRicerca = 'nessuna' | 'in-corso' | 'server' | 'solo-caricati';

export type StatoElenco = {
  /** Righe che finiscono davvero a schermo, dopo filtro e ricerca. */
  mostrati: number;
  /** Righe scaricate all'apertura (al massimo `tetto`). */
  caricati: number;
  /** Quanti profili esistono davvero. `null` = non l'ho potuto contare. */
  totale: number | null;
  /** Il tetto in vigore. */
  tetto: number;
  /** Il testo cercato, già ripulito. */
  ricerca: string;
  ambito: AmbitoRicerca;
  /** La ricerca sul database ha toccato il suo tetto di risultati. */
  ricercaTroncata?: boolean;
  /** Il filtro dei bottoncini: `all`, `pending`, oppure un ruolo. */
  filtro: string;
};

export type EtichetteElenco = {
  /** La riga sotto il titolo «Utenti». */
  sottotitolo: string;
  /** La striscia d'avviso: c'è SOLO quando c'è qualcosa da confessare. */
  avviso: string | null;
  /** Cosa si legge quando non c'è nessuna riga da mostrare. */
  vuoto: string;
};

/** Un numero come si scrive in italiano, senza dipendere da ICU: 1240 → «1.240». */
export function numeroItaliano(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * L'elenco è tagliato dal tetto?
 *
 * Il tetto ha morso se le righe scaricate sono arrivate al limite. Il conteggio
 * vero, quando c'è, lo conferma: cinquecento scaricati su cinquecento esistenti
 * NON è un elenco tagliato, ed è il caso in cui il tetto e il totale coincidono.
 */
export function elencoTroncato(s: Pick<StatoElenco, 'caricati' | 'totale' | 'tetto'>): boolean {
  if (s.caricati < s.tetto) return false;
  if (s.totale === null) return true;
  return s.totale > s.caricati;
}

/** Il nome dei bottoncini di filtro, come si legge in una frase. */
function nomeFiltro(filtro: string): string {
  const nomi: Record<string, string> = {
    buyer: 'acquirente', seller: 'venditore', rider: 'rider', admin: 'admin',
  };
  return nomi[filtro] ?? filtro;
}

/**
 * Le tre scritte dell'elenco, decise insieme.
 *
 * Insieme perché devono restare d'accordo: un sottotitolo che dice «500
 * risultati» sopra un elenco che ne ha in mano cinquecento su milleduecento è
 * esattamente il difetto da cui nasce questo file.
 */
export function etichetteElenco(s: StatoElenco): EtichetteElenco {
  const troncato = elencoTroncato(s);
  const totale = s.totale;
  const conTotale = totale === null ? '' : ` · in tutto sono ${numeroItaliano(totale)}`;

  // ── Si sta cercando ──────────────────────────────────────────────────────
  if (s.ambito === 'server') {
    const sottotitolo = s.ricercaTroncata
      ? `${numeroItaliano(s.mostrati)} risultati: sono i primi ${numeroItaliano(TETTO_RISULTATI_RICERCA)}, ce ne sono altri`
      : `${numeroItaliano(s.mostrati)} risultati, cercati su tutti gli utenti`;
    return {
      sottotitolo,
      avviso: s.ricercaTroncata
        ? `«${s.ricerca}» trova troppi utenti: ne sto mostrando i primi ${numeroItaliano(TETTO_RISULTATI_RICERCA)}. Scrivi qualche lettera in più per restringere.`
        : null,
      vuoto: `Nessun utente corrisponde a «${s.ricerca}». Ho cercato su tutti${totale === null ? '' : ` i ${numeroItaliano(totale)}`} gli utenti registrati, non solo sui più recenti.`,
    };
  }

  if (s.ambito === 'in-corso') {
    return {
      sottotitolo: `Sto cercando «${s.ricerca}» su tutti gli utenti…`,
      avviso: null,
      vuoto: `Sto cercando «${s.ricerca}» su tutti gli utenti…`,
    };
  }

  if (s.ambito === 'solo-caricati') {
    const dove = `i ${numeroItaliano(s.caricati)} profili più recenti che ho in memoria`;
    return {
      sottotitolo: `${numeroItaliano(s.mostrati)} risultati fra ${dove}`,
      avviso: `La ricerca sul database non ha risposto: sto cercando solo dentro ${dove}${conTotale}. Chi si è iscritto prima può non comparire. Riprova fra poco.`,
      vuoto: `Nessun risultato per «${s.ricerca}» fra ${dove}. La ricerca sul database non ha risposto, quindi questo NON vuol dire che quella persona non esista: riprova fra poco prima di rispondere che non è iscritta.`,
    };
  }

  // ── Nessuna ricerca: l'elenco dei più recenti ────────────────────────────
  const sottotitolo = totale === null
    ? `${numeroItaliano(s.mostrati)} in elenco · non ho potuto contare quanti utenti ci sono in tutto`
    : troncato
      ? `${numeroItaliano(s.mostrati)} dei ${numeroItaliano(s.caricati)} iscritti più recenti${conTotale}`
      : s.mostrati === totale
        ? `${numeroItaliano(totale)} utenti`
        : `${numeroItaliano(s.mostrati)} di ${numeroItaliano(totale)} utenti`;

  const avviso = troncato
    ? `Questo elenco si ferma ai ${numeroItaliano(s.caricati)} iscritti più recenti${conTotale}. Per trovare chi non compare qui scrivi nella casella di ricerca: quella domanda va al database e guarda TUTTI gli utenti.`
    : null;

  const vuoto = totale === 0
    ? 'Nessun utente registrato sulla piattaforma.'
    : s.filtro === 'pending'
      ? `Nessuna richiesta in attesa di approvazione${troncato ? ` fra i ${numeroItaliano(s.caricati)} iscritti più recenti` : ''}.`
      : s.filtro === 'all'
        ? `Nessun utente da mostrare${troncato ? ` fra i ${numeroItaliano(s.caricati)} iscritti più recenti` : ''}.`
        : `Nessun utente con ruolo «${nomeFiltro(s.filtro)}»${troncato ? ` fra i ${numeroItaliano(s.caricati)} iscritti più recenti: cercalo per nome o email, la ricerca guarda tutti gli utenti` : ''}.`;

  return { sottotitolo, avviso, vuoto };
}

/**
 * I JOLLY DEL CONFRONTO, RESI INNOCUI SENZA POTER FAR SPARIRE NESSUNO.
 *
 * In un `LIKE` di Postgres `%` vuol dire «qualunque cosa»: chi incolla un `%`
 * nella casella si porterebbe a casa TUTTI gli utenti. Qui `%` diventa `_`,
 * che vuol dire «un carattere qualsiasi»: quello che è stato scritto si trova
 * lo stesso, e la ricerca non può allargarsi a tutto. Stessa fine per la barra
 * rovescia, che è il segno di fuga.
 *
 * `_` invece resta com'è, ed è una scelta: `_` trova anche se stesso, quindi
 * chi cerca `mario_rossi@…` la sua persona la trova. Toglierlo avrebbe fatto
 * sparire una riga che esiste — cioè avrebbe rifatto il difetto da cui nasce
 * questo file, solo in piccolo. Meglio qualche riga in più che una in meno.
 */
export function testoPerIlike(termine: string): string {
  return termine.replace(/[%\\]/g, '_');
}

/**
 * Le colonne di `profiles` su cui ha senso cercare una persona.
 * L'email non c'è: vive in `auth.users` e si cerca a parte (vedi
 * `idsDaContattiAuth`).
 */
export const COLONNE_RICERCA_UTENTI = [
  'full_name', 'store_name', 'business_legal_name', 'phone', 'store_address',
] as const;

/**
 * IL FILTRO CHE VA AL DATABASE, scritto nella lingua di PostgREST.
 *
 * Restituisce `null` quando non c'è niente da cercare: chi chiama sa che non
 * deve nemmeno partire.
 *
 * Le virgole e le parentesi sono la punteggiatura di quella lingua: una virgola
 * dentro il testo cercato spezzerebbe il filtro in due condizioni, e la seconda
 * sarebbe una condizione scritta da chi cerca. Qui non passano: si tolgono
 * prima di comporre.
 */
export function filtroRicercaProfili(
  termine: string,
  colonne: readonly string[] = COLONNE_RICERCA_UTENTI,
): string | null {
  const pulito = termine.trim();
  if (pulito.length < LETTERE_MINIME_RICERCA) return null;
  // Prima via la punteggiatura della lingua dei filtri — la virgola separa le
  // condizioni, quindi dentro il testo non deve restarci — e solo dopo i jolly
  // del confronto. L'ordine conta: al contrario, togliendo la punteggiatura si
  // porterebbero via i segni di fuga appena messi.
  const senzaSintassi = pulito.replace(/[,()"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (senzaSintassi.length === 0) return null;
  const testo = testoPerIlike(senzaSintassi);
  return colonne.map((c) => `${c}.ilike.%${testo}%`).join(',');
}

/** Una riga di `auth.users` come la restituisce la RPC admin. */
export type ContattoAuth = { id: string; email?: string | null; phone?: string | null };

/**
 * Chi ha email o telefono che contengono il testo cercato.
 *
 * Serve perché l'email NON sta in `profiles`: la ricerca sul database, da sola,
 * non la vedrebbe mai — ed è proprio l'email il modo in cui si cerca una
 * persona che ha scritto per farsi cancellare.
 */
export function idsDaContattiAuth(righe: readonly ContattoAuth[], termine: string): string[] {
  const s = termine.trim().toLowerCase();
  if (s.length < LETTERE_MINIME_RICERCA) return [];
  const trovati: string[] = [];
  for (const r of righe) {
    if (!r?.id) continue;
    const email = (r.email ?? '').toLowerCase();
    const tel = (r.phone ?? '').toLowerCase();
    if (email.includes(s) || tel.includes(s)) trovati.push(r.id);
  }
  return trovati;
}

/** Unisce due elenchi tenendo una riga sola per identificativo, nell'ordine d'arrivo. */
export function unisciPerId<T extends { id: string }>(...elenchi: readonly (readonly T[])[]): T[] {
  const perId = new Map<string, T>();
  for (const elenco of elenchi) {
    for (const riga of elenco ?? []) {
      if (riga?.id && !perId.has(riga.id)) perId.set(riga.id, riga);
    }
  }
  return [...perId.values()];
}

/**
 * DOVE HA GUARDATO LA RICERCA, ADESSO.
 *
 * Sono quattro stati e si somigliano tutti, ed è il genere di catena di «se»
 * che dentro una pagina non si può provare e quindi si sbaglia: quello che
 * conta è non dire mai «non trovato» quando la risposta non è ancora arrivata,
 * e non dire mai «ho cercato ovunque» quando ha risposto solo la memoria.
 *
 * Torna anche il testo da mostrare: mentre si scrive è quello nella casella,
 * quando la risposta c'è è quello per cui la domanda è partita davvero.
 */
export function ambitoDellaRicerca(s: {
  /** Quello che c'è nella casella adesso. */
  termineScritto: string;
  /** Quello per cui la domanda al database è partita (arriva in ritardo). */
  termineCercato: string;
  /** Il database ha risposto, e con la forma giusta. */
  haRisposta: boolean;
  /** La lettura è andata in errore. */
  caduta: boolean;
}): { ambito: AmbitoRicerca; mostrato: string } {
  const scritto = s.termineScritto.trim();
  if (filtroRicercaProfili(scritto) === null) return { ambito: 'nessuna', mostrato: '' };
  if (scritto !== s.termineCercato.trim()) return { ambito: 'in-corso', mostrato: scritto };
  if (s.caduta) return { ambito: 'solo-caricati', mostrato: scritto };
  if (s.haRisposta) return { ambito: 'server', mostrato: scritto };
  return { ambito: 'in-corso', mostrato: scritto };
}

/** Il risultato di una ricerca sul database, come lo legge la pagina. */
export type RisultatoRicerca<T> = { righe: T[]; troncato: boolean };

/**
 * Una lettura che non ha la forma attesa NON è un risultato.
 *
 * Sembra pignoleria e non lo è: se qui passasse `undefined` (ricerca non ancora
 * partita) o un elenco nudo, la pagina lo mostrerebbe come «cercato su tutti
 * gli utenti» — cioè tornerebbe a dire una cosa che non ha fatto.
 */
export function risultatiRicerca<T extends { id: string }>(dato: unknown): RisultatoRicerca<T> | null {
  if (!dato || typeof dato !== 'object' || Array.isArray(dato)) return null;
  const d = dato as { righe?: unknown; troncato?: unknown };
  if (!Array.isArray(d.righe)) return null;
  return { righe: d.righe as T[], troncato: d.troncato === true };
}
