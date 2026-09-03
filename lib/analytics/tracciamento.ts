/**
 * DUE DECISIONI CHE IL BEACON PRENDEVA MALE, ORA IN UN POSTO SOLO E CONTROLLABILE.
 *
 * ① QUALI EVENTI CHIEDONO IL CONSENSO STATISTICO (R064). Il server è sempre stato scritto bene:
 *    `app/api/track/route.ts` chiede il consenso solo agli eventi di categoria «visitor» (la
 *    pagina vista), mentre accesso e disconnessione li tratta come sicurezza — legittimo interesse,
 *    ed è quello che l'informativa promette a tutti. Ma dal browser quegli eventi non partivano
 *    proprio: il cancello stava all'inizio di `send()`, prima di qualunque distinzione. Risultato:
 *    il registro degli accessi — quello che serve quando a qualcuno rubano l'account — era vuoto
 *    per tutte le persone che rifiutano i cookie statistici. Due danni in uno: un trattamento
 *    dichiarato che per una parte delle persone non avveniva, e nessuna traccia proprio per chi
 *    tiene di più alla propria privacy.
 *
 * ② QUANDO UN INDIRIZZO NUOVO È DAVVERO UNA PAGINA NUOVA (R171). La pagina dei risultati riscrive
 *    l'indirizzo a ogni tocco di filtro — categoria, prezzo, stelle, ordinamento, «solo aperti».
 *    Ognuno di quei tocchi contava come una pagina vista su tutti e tre i sistemi di misura, e
 *    gonfiava proprio la pagina a più alta intenzione d'acquisto: pagine-per-sessione, frequenza di
 *    rimbalzo e il denominatore di ogni tasso di conversione uscivano falsi.
 *
 * 🟢 Pure: nessuna rete, nessun React. Una prova le ESEGUE.
 */

import { VALORE_NASCOSTO } from './indirizzo-senza-dati-personali';

/** Gli eventi che il sito manda a `/api/track`. */
export type TipoEvento = 'page_view' | 'login' | 'logout';

/**
 * Vero se l'evento è sorveglianza del visitatore, quindi va chiesto il permesso. Accesso e
 * disconnessione sono sicurezza: si registrano comunque, e senza etichetta che segue la persona
 * (il cookie `mc_vid` la rotta non lo deposita senza consenso).
 */
export function serveIlConsensoStatistico(evento: TipoEvento): boolean {
  return evento === 'page_view';
}

/**
 * I parametri che cambiano DAVVERO pagina. Tutto il resto — i filtri — cambia solo cosa si vede
 * dentro la stessa pagina.
 */
const PARAMETRI_CHE_CONTANO = ['q'];

/**
 * 3/9/2026 — QUESTA CHIAVE SERVIVA A DUE COSE, E UNA DELLE DUE LA MANDAVA A GOOGLE.
 *
 * La chiave nasce per DISTINGUERE due pagine viste, e per quello il testo cercato serve. Ma la
 * stessa identica stringa veniva anche SPEDITA: `components/GoogleAnalytics.tsx` la passa a Google
 * come `page_path` e `page_location`. Quindi «/search?q=mario.rossi@gmail.com» partiva verso gli
 * Stati Uniti così com'era, con dentro l'email che la persona aveva scritto nella casella.
 *
 * Un valore fatto per distinguere non deve dire cosa contiene: deve solo cambiare quando cambia il
 * contenuto. Da qui esce l'impronta, non il testo. Due ricerche diverse restano due pagine diverse
 * (l'impronta cambia), sette tocchi ai filtri restano una pagina sola (i filtri non entrano), e
 * fuori non esce più niente di leggibile.
 *
 * Il testo cercato non si perde: continua ad arrivare, già ripulito da
 * `messaggioSenzaDatiPersonali`, dentro l'evento `search_performed`.
 */
function improntaDelValore(valore: string): string {
  // FNV-1a a 32 bit: stabile, senza dipendenze, uguale nel browser e sul server.
  let h = 0x811c9dc5;
  for (let i = 0; i < valore.length; i++) {
    h ^= valore.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * L'identità della pagina vista: percorso più i soli parametri che contano, col VALORE nascosto.
 * Due indirizzi che differiscono per un filtro danno la stessa chiave, quindi una pagina vista
 * sola; due ricerche diverse danno due chiavi diverse senza che il testo cercato esca da qui.
 */
export function chiaveDellaPaginaVista(
  percorso: string,
  parametri?: URLSearchParams | { toString(): string } | null,
): string {
  const testo = parametri ? String(parametri) : '';
  if (!testo) return percorso;
  const letti = new URLSearchParams(testo);
  const tenuti = new URLSearchParams();
  for (const nome of PARAMETRI_CHE_CONTANO) {
    const valore = letti.get(nome);
    // `VALORE_NASCOSTO` è lo stesso segnaposto della regola di pulizia degli indirizzi: la
    // maschera è una sola per tutto il sito, e quando cambia cambia dappertutto.
    if (valore) tenuti.set(nome, `${VALORE_NASCOSTO}${improntaDelValore(valore)}`);
  }
  const coda = tenuti.toString();
  return coda ? `${percorso}?${coda}` : percorso;
}
