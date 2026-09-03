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
 * ── LA PRIMA CURA NON CURAVA, E IL COMMENTO DICEVA DI SÌ (corretto lo stesso giorno) ───────────
 * Al posto del testo si era messa un'impronta — un numero calcolato dal testo — e qui sopra c'era
 * scritto «da qui esce l'impronta, non il testo». Non era vero, ed è il tipo di frase che spegne il
 * sospetto di chi passa di qui. Un'impronta senza segreto si rovescia provando: si prende un elenco
 * di valori plausibili, si calcola l'impronta di ognuno e si guarda quale coincide. Con 1440
 * indirizzi email costruiti a tavolino (nome.cognome@dominio) il testo cercato è tornato fuori in
 * meno di un millesimo di secondo. E nella casella la gente scrive proprio roba da elenco corto: la
 * propria email, il numero d'ordine, il telefono, il nome di un'altra persona.
 *
 * ── Perché non basta metterci un segreto ───────────────────────────────────────────────────────
 * Questa funzione gira dentro il browser. Qualunque segreto le si dia viaggia nel pacchetto che il
 * browser scarica, e un segreto che si scarica non è un segreto. Tenerlo sul server vorrebbe dire
 * chiedere al server a ogni pagina vista: un viaggio di rete per un numero che serve solo a contare.
 *
 * ── Cosa esce adesso ───────────────────────────────────────────────────────────────────────────
 * Non esce più niente che DERIVI dal testo. Questa chiave deve fare una cosa sola: dire che questa
 * pagina vista è diversa dalla precedente. Allora fuori va il posto in fila — la prima ricerca di
 * questa scheda, la seconda, la terza — che col contenuto non c'entra niente. Non c'è più niente da
 * rovesciare: mille email diverse, provate ognuna in una scheda nuova, danno tutte lo stesso `***1`.
 *
 * Il testo cercato non si perde: continua ad arrivare, già ripulito da
 * `messaggioSenzaDatiPersonali`, dentro l'evento `search_performed`.
 *
 * ⚠️ Il conto vive nella scheda di chi naviga e lì deve restare: sul server sarebbe uno solo per
 * tutti quelli che stanno guardando il sito nello stesso momento.
 */
const numeroDiOgniRicerca = new Map<string, number>();
let quanteRicerche = 0;

/** Oltre questo si ricomincia a contare: una scheda lasciata aperta un giorno non deve gonfiarsi. */
const TETTO_RICERCHE_RICORDATE = 200;

function postoInFila(valore: string): number {
  const gia = numeroDiOgniRicerca.get(valore);
  if (gia !== undefined) return gia;
  if (numeroDiOgniRicerca.size >= TETTO_RICERCHE_RICORDATE) numeroDiOgniRicerca.clear();
  quanteRicerche += 1;
  numeroDiOgniRicerca.set(valore, quanteRicerche);
  return quanteRicerche;
}

/** Solo per le prove: riporta il conto a zero, come una scheda appena aperta. */
export function __dimenticaLeRicerche(): void {
  numeroDiOgniRicerca.clear();
  quanteRicerche = 0;
}

/**
 * L'identità della pagina vista: percorso più i soli parametri che contano, col VALORE nascosto.
 * Due indirizzi che differiscono per un filtro danno la stessa chiave, quindi una pagina vista
 * sola; due ricerche diverse danno due chiavi diverse — ma quello che le distingue è il posto in
 * fila, non il contenuto, quindi da qui il testo cercato non esce e non si ricava.
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
    // maschera è una sola per tutto il sito, e quando cambia cambia dappertutto. Dopo la maschera
    // c'è il posto in fila, non un'impronta: vedi il perché qui sopra.
    if (valore) tenuti.set(nome, `${VALORE_NASCOSTO}${postoInFila(valore)}`);
  }
  const coda = tenuti.toString();
  return coda ? `${percorso}?${coda}` : percorso;
}
