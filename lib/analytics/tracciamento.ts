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
 * L'identità della pagina vista: percorso più i soli parametri che contano. Due indirizzi che
 * differiscono per un filtro danno la stessa chiave, quindi una pagina vista sola.
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
    if (valore) tenuti.set(nome, valore);
  }
  const coda = tenuti.toString();
  return coda ? `${percorso}?${coda}` : percorso;
}
