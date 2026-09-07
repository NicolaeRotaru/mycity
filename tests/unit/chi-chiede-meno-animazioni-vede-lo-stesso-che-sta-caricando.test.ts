/**
 * 6/9/2026 — CON «RIDUCI LE ANIMAZIONI» ATTIVO SPARIVA IL SEGNALE DI ATTESA.
 *
 * Nelle impostazioni del telefono e del computer c'è una voce che chiede meno
 * movimento a video: chi soffre di vertigini o mal d'auto da schermo la accende.
 * Il sito la rispettava con una regola sola, che azzerava OGNI animazione senza
 * eccezioni. Dentro quel «ogni» finivano anche le due che non sono decorazione:
 *
 *  · la rotellina `animate-spin` — la Loader2 che gira dentro un pulsante che
 *    sta lavorando (components/ui/Button.tsx) e dentro LoadingState;
 *  · la classe `.skeleton`, il grigio che scorre mentre la lista arriva.
 *
 * Per quelle persone un pulsante che sta mandando l'ordine diventava un
 * rettangolo grigio con un cerchietto immobile: nessuno diceva che stava
 * succedendo qualcosa, e la reazione naturale è ripremere.
 *
 * LA CURA. Chi chiede meno movimento chiede movimento MENO invadente, non zero
 * informazione: dentro lo stesso blocco quelle due tornano a girare, lente e
 * senza scatti (1,5 secondi, all'infinito).
 *
 * ⚪ COSA NON COPRE. Legge il foglio di stile vero, non un browser: nessuno qui
 * misura i pixel che si muovono davvero. Prova che la regola c'è, sta DENTRO il
 * blocco giusto e nomina le due classi che il codice usa davvero.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const GLOBALS = readFileSync('app/globals.css', 'utf8');
const BUTTON = readFileSync('components/ui/Button.tsx', 'utf8');
const LOADING = readFileSync('components/ui/LoadingState.tsx', 'utf8');
const BANNER = readFileSync('components/PWAInstallBanner.tsx', 'utf8');

/** Il testo dentro `@media (prefers-reduced-motion: reduce) { … }`. */
function blocoMenoMovimento(): string {
  const inizio = GLOBALS.indexOf('@media (prefers-reduced-motion: reduce)');
  expect(inizio).toBeGreaterThan(-1);
  let profondita = 0;
  for (let i = GLOBALS.indexOf('{', inizio); i < GLOBALS.length; i++) {
    if (GLOBALS[i] === '{') profondita++;
    else if (GLOBALS[i] === '}' && --profondita === 0) return GLOBALS.slice(inizio, i + 1);
  }
  throw new Error('il blocco «riduci le animazioni» non si chiude');
}

describe('chi ha chiesto meno animazioni', () => {
  const blocco = blocoMenoMovimento();

  it('vede ancora girare la rotellina e scorrere lo scheletro', () => {
    expect(blocco).toMatch(/\.animate-spin\s*,\s*\.skeleton\s*\{/);
    expect(blocco).toMatch(/animation-iteration-count:\s*infinite\s*!important/);
  });

  it('e le vede girare piano, non alla velocità di prima', () => {
    const durata = blocco.match(/\.animate-spin[\s\S]*?animation-duration:\s*([\d.]+)s/);
    expect(durata).not.toBeNull();
    expect(Number(durata![1])).toBeGreaterThanOrEqual(1);
  });

  it('le due classi sono quelle che il sito usa davvero per dire «sto lavorando»', () => {
    // Se un domani il segnale d'attesa cambia nome, l'eccezione qui sopra
    // protegge una classe morta e nessuno se ne accorge.
    expect(BUTTON).toContain('animate-spin');
    expect(LOADING).toContain('animate-spin');
    expect(GLOBALS).toMatch(/\.skeleton\s*\{/);
  });
});

/**
 * 6/9/2026 — NEL BANNER «METTI MYCITY IN SCHERMATA HOME» NON SI PRENDEVA LA X.
 *
 * Il banner compare in fondo allo schermo, sopra la barra delle schede. I due
 * modi per chiuderlo — «Più tardi» e la crocetta — erano alti quanto il loro
 * testo: circa 28 e 24 pixel, sotto i 44 che servono per centrare un bersaglio
 * col pollice al primo colpo. Chi sbagliava mira apriva una scheda che non
 * voleva, e il banner restava lì.
 */
describe('il banner che invita a installare si chiude al primo tocco', () => {
  /**
   * Le etichette d'apertura dei `<button>`. Si taglia sul `>` che sta da solo a
   * capo, non sul primo `>` incontrato: dentro c'e' `() => dismiss()`, e una
   * freccia porta un `>` che spezzerebbe l'etichetta a meta'.
   */
  const bottoni = [...BANNER.matchAll(/<button\b[\s\S]*?\n\s*>/g)].map((m) => m[0]);

  it('i due modi di chiuderlo sono larghi almeno quanto un pollice', () => {
    const chiusure = bottoni.filter((b) => b.includes('dismiss()'));
    expect(chiusure).toHaveLength(2);
    for (const b of chiusure) expect(b).toContain('min-h-[44px]');
    expect(chiusure.some((b) => b.includes('min-w-[44px]'))).toBe(true);
  });

  it('non è rimasto il riempimento vecchio, che li teneva piccoli', () => {
    const chiusure = bottoni.filter((b) => b.includes('dismiss()'));
    for (const b of chiusure) expect(b).not.toMatch(/\bpy-1\.5\b|\bp-1\b/);
  });

  it('la crocetta ha ancora la sua etichetta per chi legge con la voce', () => {
    expect(BANNER).toContain('aria-label="Chiudi"');
  });
});
