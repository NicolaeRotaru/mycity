/**
 * 8/9/2026 — IL FILMATO DELLO SCHERMO PORTAVA FUORI L'INDIRIZZO INTERO, E IL
 * CANCELLO CI PASSAVA SOPRA A VUOTO.
 *
 * ── COS'ERA ROTTO ──────────────────────────────────────────────────────────
 * Il cancello di PostHog (`before_send`) riscriveva un elenco chiuso di nove
 * NOMI di proprieta': `$current_url`, `$referrer`, `$pathname`, `$initial_*`,
 * `$session_entry_*`. Sul filmato dello schermo quei nove nomi non esistono, per
 * due motivi verificati dentro `node_modules/posthog-js/dist/`:
 *
 * ① la libreria, in `calculateEventProperties`, esce SUBITO per l'evento
 *    `$snapshot` («"$snapshot"===e … return h»): a quell'evento le proprieta'
 *    d'indirizzo non le attacca nemmeno. Il sanificatore girava a vuoto;
 * ② l'indirizzo vero sta dentro `$snapshot_data`. Il registratore apre ogni
 *    filmato con la sua targa — `{type: Meta, data:{href: window.location.href,
 *    width, height}}` — cioe' l'indirizzo INTERO letto dal browser.
 *
 * Sulla pagina dei risultati quell'indirizzo e' `/search?q=…`, e nella casella
 * la gente scrive la propria email, il telefono, il nome di un'altra persona.
 * Il testo nella pagina e' mascherato (`maskTextSelector:'*'`); l'indirizzo no.
 *
 * ── LA MALATTIA, NON IL SINTOMO ────────────────────────────────────────────
 * Il difetto non era «manca `href` nell'elenco»: era che l'elenco esiste. Un
 * cancello che pulisce per NOME lascia passare qualunque canale che usi un nome
 * nuovo. Qui si pulisce per CONTENUTO: qualunque testo, sotto qualunque chiave,
 * a qualunque profondita', se contiene un indirizzo viene riscritto con la
 * regola comune (`indirizzoSenzaDatiPersonali`). Un canale che nessuno ha ancora
 * scritto e' pulito il giorno in cui nasce, non il giorno in cui ce ne accorgiamo.
 *
 * ── LA SOLA ECCEZIONE, DICHIARATA ──────────────────────────────────────────
 * Il DOM del filmato (rrweb `FullSnapshot` e `IncrementalSnapshot`) NON si tocca.
 * Tre ragioni, tutte e tre pesate:
 *   • e' gia' mascherato all'origine (`maskAllInputs`, `maskTextSelector:'*'`);
 *   • li' dentro gli indirizzi sono i fogli di stile e le immagini: riscriverli
 *     vuol dire un filmato che si riproduce senza grafica;
 *   • sono i pezzi grossi, e la libreria li spedisce anche compressi. Camminarci
 *     dentro a ogni fotogramma, di fila sul filo principale, si sentirebbe sul
 *     telefono di chi sta comprando.
 * Il residuo che resta scoperto e' scritto nella nota del difetto: il valore di
 * un attributo del DOM (un `href` di un link) non passa di qui.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun `window`. Una prova lo ESEGUE
 *    (`tests/unit/il-filmato-non-porta-fuori-la-ricerca.test.ts`).
 */

import { indirizzoSenzaDatiPersonali, VALORE_NASCOSTO } from './indirizzo-senza-dati-personali';

/**
 * I due tipi di evento rrweb che portano il DOM del filmato: `FullSnapshot` (2) e
 * `IncrementalSnapshot` (3). Sono gli unici che questo cancello lascia passare
 * interi, per le tre ragioni scritte sopra. Tutto il resto — targa, eventi
 * personalizzati, plugin, e ogni tipo che ancora non esiste — si pulisce.
 */
export const TIPI_RRWEB_CHE_PORTANO_IL_DOM: ReadonlySet<number> = new Set([2, 3]);

/**
 * Un indirizzo dentro un testo qualsiasi: intero (`https://…`) oppure relativo
 * con dei parametri (`/search?q=…`). Un percorso senza parametri non si tocca:
 * della strada si tiene tutto, e' la regola comune di tutto il sito.
 */
const UN_INDIRIZZO_DENTRO_IL_TESTO = /https?:\/\/[^\s"'<>()\\]+|\/[^\s"'<>()\\]*\?[^\s"'<>()\\]*/g;

/** Oltre questo un testo non arriva da una navigazione vera: si nasconde intero. */
const TESTO_TROPPO_LUNGO = 50_000;

/** Quanto in fondo si scende e quanti pezzi si guardano prima di chiudere a chiave. */
const PROFONDITA_MASSIMA = 12;
const PEZZI_MASSIMI = 20_000;

/**
 * Riscrive ogni indirizzo contenuto in un testo, lasciando intatto il resto.
 * Della strada si tiene tutto, dei parametri si tiene il nome e si nasconde il
 * valore, il pezzo dopo il cancelletto sparisce: e' la stessa regola del beacon
 * delle visite e del registratore degli errori, non una seconda regola.
 */
export function testoSenzaIndirizzi(testo: string): string {
  if (!testo) return testo;
  // Un testo cosi' lungo non e' un indirizzo ne' un messaggio: si chiude a chiave.
  if (testo.length > TESTO_TROPPO_LUNGO) return VALORE_NASCOSTO;
  if (!testo.includes('/')) return testo; // nessun indirizzo possibile: niente da fare
  return testo.replace(
    UN_INDIRIZZO_DENTRO_IL_TESTO,
    (indirizzo) => indirizzoSenzaDatiPersonali(indirizzo) ?? VALORE_NASCOSTO,
  );
}

type Conteggio = { pezzi: number };

/**
 * La stessa rete, senza nessuna eccezione: scende dentro qualunque struttura e
 * riscrive ogni indirizzo che trova. Serve a tutto cio' che NON e' il filmato —
 * per esempio l'elenco degli elementi cliccati (`$elements`), dove `attr__href`
 * porta l'indirizzo del link su cui si e' cliccato.
 *
 * Sta separata apposta: l'eccezione del DOM vale solo dentro il filmato. Una
 * proprieta' qualunque che per caso somigli a un fotogramma (`{type: 2, …}`)
 * non deve poter ereditare quel salvacondotto.
 */
export function strutturaSenzaIndirizzi(valore: unknown): unknown {
  try {
    return ripulisci(valore, 0, { pezzi: 0 });
  } catch {
    return valore;
  }
}

/** Scende dentro qualunque forma e riscrive ogni testo che contiene un indirizzo. */
function ripulisci(valore: unknown, profondita: number, conto: Conteggio): unknown {
  // Numeri, booleani, vuoti: non possono contenere un indirizzo, e riscriverli
  // romperebbe il filmato (la misura dello schermo, i tempi, gli identificativi).
  if (valore === null || valore === undefined) return valore;
  const tipo = typeof valore;
  if (tipo !== 'string' && tipo !== 'object') return valore;

  // Finito il budget si chiude a chiave, non si lascia passare: un cancello che
  // in caso di dubbio apre non e' un cancello.
  conto.pezzi += 1;
  if (profondita > PROFONDITA_MASSIMA || conto.pezzi > PEZZI_MASSIMI) return VALORE_NASCOSTO;

  if (tipo === 'string') return testoSenzaIndirizzi(valore as string);
  if (Array.isArray(valore)) return valore.map((v) => ripulisci(v, profondita + 1, conto));

  const dentro = valore as Record<string, unknown>;
  const pulito: Record<string, unknown> = {};
  for (const chiave of Object.keys(dentro)) {
    pulito[chiave] = ripulisci(dentro[chiave], profondita + 1, conto);
  }
  return pulito;
}

/** Ha la forma di un evento rrweb? (`{type: <numero>, data: …}`) */
function sembraUnEventoDelFilmato(valore: unknown): valore is { type: number } & Record<string, unknown> {
  return !!valore && typeof valore === 'object' && !Array.isArray(valore)
    && typeof (valore as { type?: unknown }).type === 'number';
}

/**
 * Il cancello sul filmato: prende quello che PostHog mette in `$snapshot_data` —
 * un evento rrweb, un elenco di eventi, o un elenco di elenchi — e torna la
 * stessa cosa senza gli indirizzi delle persone.
 *
 * Non lancia mai: la telemetria non deve poter rompere una pagina. Se qualcosa
 * va storto torna quello che ha in mano, e la seconda rete resta il fatto che
 * `/search` si puo' togliere dalle pagine filmabili.
 */
export function filmatoSenzaDatiPersonali(datiDelFilmato: unknown): unknown {
  try {
    return unPezzoDiFilmato(datiDelFilmato, 0, { pezzi: 0 });
  } catch {
    return datiDelFilmato;
  }
}

function unPezzoDiFilmato(valore: unknown, profondita: number, conto: Conteggio): unknown {
  if (Array.isArray(valore)) return valore.map((v) => unPezzoDiFilmato(v, profondita + 1, conto));
  if (sembraUnEventoDelFilmato(valore)) {
    // Il DOM del filmato passa intero: e' l'eccezione dichiarata qui sopra.
    if (TIPI_RRWEB_CHE_PORTANO_IL_DOM.has(valore.type)) return valore;
    return { ...valore, data: ripulisci(valore.data, profondita + 1, conto) };
  }
  // Non ha la forma di un evento rrweb: nel dubbio si pulisce.
  return ripulisci(valore, profondita, conto);
}
