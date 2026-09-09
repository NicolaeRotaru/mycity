/**
 * QUANTO STACCA UN TESTO DAL SUO SFONDO — il conto, non l'impressione.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────
 * `olive-500` (#7C8B5A) e `olive-600` (#5A7C42) sono due verdi vicini, e per
 * l'occhio si somigliano. Col bianco sopra non si somigliano affatto: il primo
 * stacca 3,69 volte, il secondo 4,78, e per un testo lo standard ne chiede 4,5
 * (WCAG 2.1 — 1.4.3, livello AA). In dieci punti del sito era stato scelto il
 * primo: la pastiglia «Aperto ora» sulla copertina del negozio, la pastiglia
 * dello sconto in cassa, la spunta dei passi del pagamento. Cioè le righe che
 * dicono al cliente se può ordinare adesso e quanto paga.
 *
 * ── Perché un file, e non dieci correzioni ───────────────────────────────────
 * Le dieci correzioni erano già state fatte, e il difetto è tornato lo stesso:
 * il 6/9 due sfumature nuove (`from-olive-500 … text-white`) hanno rimesso in
 * pagina lo stesso 3,69, perché niente lo poteva fermare. La formula del
 * contrasto viveva solo dentro i file di prova — dieci copie, ognuna con la sua
 * soglia scritta a mano — quindi nessuno poteva CHIAMARLA per dire «questo
 * accostamento non si legge».
 *
 * Qui la regola scende di un piano ed è una sola: si passa il codice sorgente
 * di un componente e la tavolozza vera del sito, e si riceve l'elenco degli
 * accostamenti che non arrivano alla soglia. Il numero lo calcola la formula
 * dello standard sui colori veri: se domani qualcuno schiarisce un tono nella
 * tavolozza, o rimette una sfumatura chiara sotto del testo bianco, la prova
 * che chiama questa funzione diventa rossa da sola.
 *
 * 🟢 Pura: nessuna rete, nessun React, nessun disco, nessun orologio. Chi legge
 * i file glieli passa già letti. Una prova la ESEGUE.
 */

/** Il minimo che lo standard chiede a un testo normale (WCAG 2.1 — 1.4.3 AA). */
export const SOGLIA_TESTO = 4.5;

/**
 * Il minimo per il testo grande (da 18,66px in grassetto o 24px normale) e per
 * le parti grafiche di un comando (WCAG 2.1 — 1.4.11).
 */
export const SOGLIA_GRAFICA = 3;

/** Il bianco, che è il colore di testo di quasi tutte le pastiglie del sito. */
export const BIANCO = '#FFFFFF';

/** I tre canali di un colore scritto in esadecimale, con o senza cancelletto. */
export function daEsadecimale(colore: string): [number, number, number] {
  const c = colore.replace('#', '').trim();
  const pieno = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  return [
    parseInt(pieno.slice(0, 2), 16),
    parseInt(pieno.slice(2, 4), 16),
    parseInt(pieno.slice(4, 6), 16),
  ];
}

/** La luminanza relativa, come la definisce lo standard. */
export function luminanzaRelativa(colore: string): number {
  const [r, g, b] = daEsadecimale(colore).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Il rapporto di contrasto fra due colori: il più chiaro sopra il più scuro,
 * più 0,05 per parte. Va da 1 (identici) a 21 (bianco su nero).
 */
export function contrasto(primo: string, secondo: string): number {
  const a = luminanzaRelativa(primo);
  const b = luminanzaRelativa(secondo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Questo accostamento arriva alla soglia? */
export function siLegge(sfondo: string, testo: string, soglia: number = SOGLIA_TESTO): boolean {
  return contrasto(sfondo, testo) >= soglia;
}

/**
 * La tavolozza vera del sito, letta dal foglio di stile.
 *
 * Prende il TESTO di `app/globals.css` — chi chiama lo legge dal disco — e
 * torna `{ 'olive-600': '#5A7C42', … }`. I colori non si scrivono qui: si
 * leggono da dove il sito li dichiara, altrimenti la prova misura una copia
 * ferma al giorno in cui è stata scritta.
 */
export function tavolozzaDaCss(css: string): Record<string, string> {
  const mappa: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z]+)-(\d{2,3})\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    mappa[`${m[1]}-${m[2]}`] = m[3].toUpperCase();
  }
  return mappa;
}

/**
 * Un pezzo di sorgente che non ha attraversato una virgoletta o una parentesi
 * graffa: è al massimo la lista di classi di UN elemento, mai due mescolate.
 *
 * Serve perché le pastiglie nascono da un ternario dentro un modello di
 * stringa, e i due rami hanno due sfondi diversi: mescolarli darebbe una
 * risposta sbagliata — «bianco su cream-200», che nessuno ha mai scritto.
 */
export function listeDiClassi(sorgente: string): string[] {
  return sorgente.split(/[`'"{}]/);
}

/**
 * I toni della tavolozza che dipingono il fondo dietro a questa lista di classi.
 *
 * Sono il fondo pieno (`bg-olive-600`) e OGNI fermata di una sfumatura
 * (`from-`, `via-`, `to-`): il testo passa sopra tutte, quindi la più chiara
 * decide se si legge. È il buco da cui il difetto è rientrato il 6/9, quando le
 * dieci pastiglie erano già state corrette ma `from-olive-500` no.
 *
 * Restano fuori due cose, e per due motivi diversi:
 *  · i toni con la trasparenza (`bg-white/10`), perché quel colore dipende da
 *    cosa c'è sotto e da qui non si calcola: chi ne ha uno lo misura a mano,
 *    come fa la prova dei riquadri del cruscotto;
 *  · i fondi di uno stato che cambia anche il colore del testo — tipico
 *    `disabled:bg-cream-200 disabled:text-ink-400`: lì il testo bianco non c'è,
 *    e contarlo darebbe un allarme falso. Uno stato che il testo NON lo cambia
 *    (`hover:bg-…` con il bianco che resta bianco) invece conta eccome.
 */
export function fondiDiUnaListaDiClassi(lista: string): string[] {
  const toni = new Set<string>();
  for (const m of lista.matchAll(/(?:^|\s)((?:[a-z-]+:)*)(?:bg|from|via|to)-([a-z]+-\d{2,3})\b(?!\/)/g)) {
    const stato = m[1];
    if (stato && new RegExp(`(?:^|\\s)${stato}text-`).test(lista)) continue;
    toni.add(m[2]);
  }
  return [...toni];
}

export type AccostamentoDebole = {
  /** Il tono della tavolozza usato come fondo, es. `olive-500`. */
  sfondo: string;
  /** Il suo esadecimale vero, es. `#7C8B5A`. */
  colore: string;
  /** Quante volte stacca dal testo. */
  misura: number;
  /** La lista di classi in cui è scritto, per ritrovarlo. */
  classi: string;
};

/**
 * Gli accostamenti di questo sorgente in cui il testo bianco NON arriva alla
 * soglia, col numero misurato sui colori veri.
 *
 * Torna una lista vuota quando va tutto bene: è la forma che rende leggibile
 * una prova rossa, perché il messaggio d'errore contiene già il file, il tono e
 * il numero.
 */
export function accostamentiBianchiDeboli(
  sorgente: string,
  tavolozza: Record<string, string>,
  soglia: number = SOGLIA_TESTO,
): AccostamentoDebole[] {
  const deboli: AccostamentoDebole[] = [];
  for (const lista of listeDiClassi(sorgente)) {
    if (!/\btext-white\b/.test(lista)) continue;
    for (const tono of fondiDiUnaListaDiClassi(lista)) {
      const colore = tavolozza[tono];
      if (!colore) continue;
      const misura = contrasto(colore, BIANCO);
      if (misura < soglia) deboli.push({ sfondo: tono, colore, misura, classi: lista.trim() });
    }
  }
  return deboli;
}

/**
 * Quanti accostamenti bianco-su-colore ci sono in tutto in questo sorgente,
 * deboli o no.
 *
 * Non serve a giudicare: serve a una prova per sapere che sta guardando
 * qualcosa. Una scansione che non trova più niente passerebbe sempre, e sarebbe
 * il modo più silenzioso di perdere questa difesa.
 */
export function quantiAccostamentiBianchi(sorgente: string, tavolozza: Record<string, string>): number {
  let n = 0;
  for (const lista of listeDiClassi(sorgente)) {
    if (!/\btext-white\b/.test(lista)) continue;
    for (const tono of fondiDiUnaListaDiClassi(lista)) if (tavolozza[tono]) n += 1;
  }
  return n;
}
