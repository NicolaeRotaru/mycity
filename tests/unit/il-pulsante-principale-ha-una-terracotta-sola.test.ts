/**
 * 3/9/2026 — DUE TERRACOTTE DIVERSE PER LO STESSO PULSANTE.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Il pulsante principale del sito ha una casa sola: `components/ui/Button.tsx`, variante `primary`.
 * Da lì esce `bg-primary-700`, cioè #A03B25 — lo stesso colore che il foglio di stile chiama
 * `--color-cta`, «il colore del pulsante che fa comprare».
 *
 * Nella pagina di ricerca, però, i pulsanti pieni erano scritti a mano con la terracotta di un tono
 * più chiaro (`primary-600`, #C0492C): «Mostra risultati» in fondo al pannello dei filtri, il
 * pulsante «Filtri» quando è acceso, i pulsanti del voto minimo. Nella stessa schermata convivevano
 * due rossi diversi per lo stesso gesto. Chi guarda non sa dire perché, ma sente che qualcosa non
 * torna — e su un sito dove si lascia la carta di credito quella sensazione costa.
 *
 * ── La radice ───────────────────────────────────────────────────────────────────────────────────
 * Le due terracotte sono l'una accanto all'altra nella tavolozza: chi scrive una schermata nuova
 * pesca l'una o l'altra senza accorgersene, e un colore scritto a mano in due posti diverge in
 * silenzio. Contati nel giorno della cura: 92 usi di `primary-700` contro 61 di `primary-600` in
 * tutto `app/` e `components/`.
 *
 * ── Cosa prova questo file, e perché non cerca parole ───────────────────────────────────────────
 * I colori non sono scritti qui dentro: se li CALCOLA dalla tavolozza vera — la rampa di
 * `tailwind.config.ts`, da cui nascono le classi, e quella di `app/globals.css`, da cui nasce il
 * token `--color-cta` — e poi confronta i valori esadecimali. Cambiare la tavolozza non fa mentire
 * questa prova: la fa ricalcolare.
 *
 * Guarda le tre pagine di questo lotto (ricerca, carrello, categoria). Nel resto del sito lo
 * stesso scivolone esiste ancora — 37 fra pulsanti e link in 30 file, contati il 3/9: è un difetto
 * a parte, non un verde finto qui dentro.
 *
 * ⚠️ Cosa NON prova: che a schermo i due rossi si distinguano a occhio. Qui non c'è un browser: si
 * confrontano i valori, non i pixel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RADICE = process.cwd();
const leggi = (p: string) => readFileSync(join(RADICE, p), 'utf8');

const GLOBALS = leggi('app/globals.css');
const TAILWIND = leggi('tailwind.config.ts');
const BOTTONE = leggi('components/ui/Button.tsx');

/* ─────────────────────────────────────────────────────────────────────────────
 * La tavolozza, letta dalle sue due case.
 * ───────────────────────────────────────────────────────────────────────────── */

/** La rampa terracotta come la conosce il foglio di stile: `--primary-700:#A03B25`. */
function rampaDelFoglio(): Map<string, string> {
  const mappa = new Map<string, string>();
  for (const m of GLOBALS.matchAll(/--primary-(\d{2,3})\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    mappa.set(m[1], m[2].toUpperCase());
  }
  return mappa;
}

/** La rampa terracotta come la conosce Tailwind: è lei che genera le classi `bg-primary-700`. */
function rampaDelleClassi(): Map<string, string> {
  const blocco = TAILWIND.slice(TAILWIND.indexOf('primary: {'));
  const mappa = new Map<string, string>();
  for (const m of blocco.slice(0, blocco.indexOf('}')).matchAll(/(\d{2,3}):\s*'(#[0-9A-Fa-f]{6})'/g)) {
    mappa.set(m[1], m[2].toUpperCase());
  }
  return mappa;
}

const FOGLIO = rampaDelFoglio();
const CLASSI = rampaDelleClassi();

/** Il tono a cui punta un alias del foglio di stile: `--color-cta: var(--primary-700)` → `700`. */
function tonoDellAlias(alias: string): string {
  const m = GLOBALS.match(new RegExp(`--${alias}\\s*:\\s*var\\(--primary-(\\d{2,3})\\)`));
  expect(m, `in app/globals.css non c'è più --${alias}: questa prova non misura niente`).toBeTruthy();
  return m![1];
}

/** Il tono del fondo pieno della variante principale di Button. */
function tonoDelPulsantePrincipale(): string {
  const riga = BOTTONE.split('\n').find((r) => /^\s*primary:/.test(r));
  expect(riga, 'in components/ui/Button.tsx non c\'è più la variante `primary`').toBeTruthy();
  const m = riga!.match(/\bbg-primary-(\d{2,3})\b/);
  expect(m, 'la variante `primary` non ha più un fondo terracotta: la prova va riscritta').toBeTruthy();
  return m![1];
}

/* ─────────────────────────────────────────────────────────────────────────────
 * I fondi pieni delle due pagine, con l'elemento che li porta addosso.
 * ───────────────────────────────────────────────────────────────────────────── */

/** Toglie i commenti lasciando la stessa lunghezza: così i numeri di riga restano quelli veri. */
const senzaCommenti = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/**
 * Un fondo pieno terracotta: dal 500 in su. I toni chiari (50, 100, 200) sono sfondi di riquadri
 * con la scritta scura, non pulsanti pieni, e non c'entrano con questa regola.
 * Le varianti di stato (`hover:`, `focus:`…) si guardano a parte, qui sotto.
 */
const FONDO_PIENO = /(?<!hover:)(?<!focus:)(?<!active:)(?<!group-hover:)(?<!focus-visible:)bg-primary-([5-9]00)\b/g;

/** Gli elementi su cui si clicca: è lì che il colore del pulsante principale deve essere quello. */
const SI_CLICCA = new Set(['button', 'Link', 'a']);

type Fondo = { file: string; riga: number; tag: string; tono: string; classi: string };

function fondiPieni(file: string): Fondo[] {
  const src = senzaCommenti(leggi(file));
  const trovati: Fondo[] = [];
  for (const m of src.matchAll(FONDO_PIENO)) {
    const i = m.index!;
    const prima = src.slice(0, i);
    // L'elemento che porta la classe è il tag aperto più di recente: `className` sta dentro la sua
    // parentesi acuta, quindi fra `<button` e la classe non può essersene aperto un altro.
    const tag = [...prima.matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)].pop();
    // L'elenco di classi è la stringa che contiene la classe trovata.
    const apre = Math.max(prima.lastIndexOf('"'), prima.lastIndexOf("'"), prima.lastIndexOf('`'));
    const virgoletta = src[apre];
    const chiude = src.indexOf(virgoletta, i);
    trovati.push({
      file,
      riga: prima.split('\n').length,
      tag: tag ? tag[1] : '?',
      tono: m[1],
      classi: src.slice(apre + 1, chiude === -1 ? i : chiude),
    });
  }
  return trovati;
}

const PAGINE = ['app/search/page.tsx', 'app/cart/page.tsx', 'app/category/[slug]/page.tsx'];
const FONDI = PAGINE.flatMap(fondiPieni);
const CLICCABILI = FONDI.filter((f) => SI_CLICCA.has(f.tag));

/* ───────────────────────────────────────────────────────────────────────────── */

describe('la tavolozza da cui si calcolano i colori', () => {
  it('esiste in tutte e due le case, e le due case dicono la stessa cosa', () => {
    expect(FOGLIO.size, 'la rampa terracotta di app/globals.css non si legge più').toBeGreaterThan(5);
    expect(CLASSI.size, 'la rampa terracotta di tailwind.config.ts non si legge più').toBeGreaterThan(5);
    for (const [tono, colore] of CLASSI) {
      // Se le due rampe divergono, il token dice un colore e la classe ne dipinge un altro: la
      // stessa malattia, un piano più sotto.
      expect(FOGLIO.get(tono), `il tono ${tono} vale ${colore} per le classi`).toBe(colore);
    }
  });
});

describe('il pulsante principale del sito', () => {
  it('è dipinto con il colore che il foglio di stile chiama «colore del pulsante»', () => {
    const dalBottone = CLASSI.get(tonoDelPulsantePrincipale());
    const dalToken = FOGLIO.get(tonoDellAlias('color-cta'));
    expect(dalBottone).toBe(dalToken);
  });
});

describe('nella ricerca, nel carrello e nella pagina di una categoria', () => {
  it('c è qualcosa da guardare: se sparisce, questa prova non misura più niente', () => {
    expect(CLICCABILI.length).toBeGreaterThan(0);
  });

  it('ogni pulsante pieno terracotta ha lo stesso rosso del pulsante principale', () => {
    const atteso = FOGLIO.get(tonoDellAlias('color-cta'));
    const sbagliati = CLICCABILI
      .filter((f) => CLASSI.get(f.tono) !== atteso)
      .map((f) => `${f.file}:${f.riga} <${f.tag}> è ${CLASSI.get(f.tono)} (primary-${f.tono})`);
    expect(sbagliati, `il rosso del pulsante che fa comprare è ${atteso}: qui ce n'è un altro`).toEqual([]);
  });

  it('e anche il rosso che compare col dito sopra è quello giusto', () => {
    const attesoHover = FOGLIO.get(tonoDellAlias('color-cta-hover'));
    const sbagliati = CLICCABILI
      .map((f) => ({ f, hover: f.classi.match(/hover:bg-primary-(\d{2,3})\b/) }))
      .filter(({ hover }) => hover !== null && CLASSI.get(hover![1]) !== attesoHover)
      .map(({ f, hover }) => `${f.file}:${f.riga} <${f.tag}> passa a primary-${hover![1]}`);
    expect(sbagliati, `sotto il dito il pulsante principale diventa ${attesoHover}`).toEqual([]);
  });

  it('il tono più chiaro resta ai pallini e ai contatori, che pulsanti non sono', () => {
    // Non è un divieto: è il confine. `primary-600` va benissimo su uno `<span>` che conta i filtri
    // attivi — quello non è il pulsante che fa comprare e nessuno lo confronta con lui.
    const chiari = FONDI.filter((f) => f.tono === '600' && !SI_CLICCA.has(f.tag));
    for (const c of chiari) expect(SI_CLICCA.has(c.tag)).toBe(false);
  });
});
