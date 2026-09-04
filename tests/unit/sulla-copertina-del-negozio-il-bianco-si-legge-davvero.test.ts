/**
 * 3/9/2026 — «APERTO ORA» ERA BIANCO SU UN VERDE TROPPO CHIARO.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * Sulla copertina del negozio, in alto a destra, c'è la pastiglia che dice se si
 * può comprare adesso. Era testo bianco su `olive-500` (#7C8B5A): il rapporto
 * fra i due colori è 3,69 a 1, e per un testo ne servono 4,5 (WCAG 2.1 — 1.4.3
 * Contrasto minimo, livello AA). Con `olive-600` (#5A7C42) sale a 4,78.
 *
 * Non è una finezza da manuale: è la riga che dice a chi guarda se il negozio è
 * aperto, letta da fuori, con lo schermo al sole e spesso da chi ha la vista
 * stanca. Se non si legge, il cliente non sa se può ordinare.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * Il conto vero, non la parola. I colori si leggono dalla tavolozza in
 * `app/globals.css`, la classe si legge dal componente, e il rapporto di
 * contrasto si CALCOLA con la formula dello standard. Se domani qualcuno
 * schiarisce `olive-600` nella tavolozza, o rimette una pastiglia chiara sotto
 * del testo bianco in una qualunque sezione della vetrina, questa prova diventa
 * rossa da sola.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RADICE = process.cwd();
const SEZIONI = join(RADICE, 'components/store-sections');

/** La soglia dello standard per un testo normale. */
const SOGLIA_TESTO = 4.5;

// ── Il calcolo del contrasto, dalla formula WCAG 2.1 ────────────────────────

function canaleLineare(valore: number): number {
  const c = valore / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminosita(esadecimale: string): number {
  const n = parseInt(esadecimale.slice(1), 16);
  const r = canaleLineare((n >> 16) & 0xff);
  const g = canaleLineare((n >> 8) & 0xff);
  const b = canaleLineare(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrasto(a: string, b: string): number {
  const la = luminosita(a);
  const lb = luminosita(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const BIANCO = '#FFFFFF';

// ── La tavolozza vera, letta dal foglio di stile ────────────────────────────

/** Ogni `--nome-tono:#RRGGBB` dichiarato in globals.css. */
const TAVOLOZZA: Record<string, string> = (() => {
  const css = readFileSync(join(RADICE, 'app/globals.css'), 'utf8');
  const mappa: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z]+)-(\d{2,3})\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    mappa[`${m[1]}-${m[2]}`] = m[3].toUpperCase();
  }
  return mappa;
})();

// ── Le liste di classi scritte nei componenti della vetrina ─────────────────

/**
 * Un pezzo di testo che non ha attraversato una virgoletta o una parentesi
 * graffa: è al massimo una lista di classi, mai due mescolate. Serve perché le
 * pastiglie nascono da un `ternario` dentro un modello di stringa, e i due rami
 * hanno due sfondi diversi: mescolarli darebbe una risposta sbagliata.
 */
function listeDiClassi(sorgente: string): string[] {
  return sorgente.split(/[`'"{}]/);
}

type Coppia = { file: string; sfondo: string; classi: string };

function coppieBiancoSuColore(sorgente: string, file: string): Coppia[] {
  const trovate: Coppia[] = [];
  for (const lista of listeDiClassi(sorgente)) {
    if (!/\btext-white\b/.test(lista)) continue;
    // `bg-black/60` e `bg-white/90` restano fuori apposta: il tono con la
    // trasparenza dipende da cosa c'è sotto e non si calcola da qui.
    for (const m of lista.matchAll(/\bbg-([a-z]+)-(\d{2,3})\b(?!\/)/g)) {
      trovate.push({ file, sfondo: `${m[1]}-${m[2]}`, classi: lista.trim() });
    }
  }
  return trovate;
}

function tsxDellaVetrina(): string[] {
  return readdirSync(SEZIONI).filter((f) => f.endsWith('.tsx'));
}

// ── Le prove ────────────────────────────────────────────────────────────────

describe('il calcolo del contrasto è quello dello standard, non un numero inventato', () => {
  it('bianco su nero fa 21, il massimo possibile', () => {
    expect(contrasto('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('riconosce il verde di prima come insufficiente e quello di adesso come buono', () => {
    // Sono i due numeri della scheda: se il calcolo si rompesse e tornasse
    // sempre un valore alto, la prova qui sotto passerebbe senza guardare
    // niente. Questa riga lo impedisce.
    expect(contrasto('#7C8B5A', BIANCO)).toBeCloseTo(3.69, 1);
    expect(contrasto('#5A7C42', BIANCO)).toBeCloseTo(4.78, 1);
    expect(contrasto('#7C8B5A', BIANCO)).toBeLessThan(SOGLIA_TESTO);
    expect(contrasto('#5A7C42', BIANCO)).toBeGreaterThanOrEqual(SOGLIA_TESTO);
  });

  it('la tavolozza è quella vera del sito', () => {
    expect(Object.keys(TAVOLOZZA).length, 'non ho letto nessun colore da globals.css').toBeGreaterThan(20);
    expect(TAVOLOZZA['olive-600'], 'olive-600 non esiste più nella tavolozza').toBeTruthy();
  });
});

describe('la pastiglia che dice se il negozio è aperto', () => {
  const src = readFileSync(join(SEZIONI, 'HeroSection.tsx'), 'utf8');

  /** Il ramo «aperto» del ternario: la lista di classi vera della pastiglia. */
  const pastiglia = (() => {
    const m = src.match(/openNow \? '([^']+)'/);
    return m?.[1] ?? null;
  })();

  it('esiste ancora e si trova: senza, questa prova non misura niente', () => {
    expect(pastiglia, 'non trovo più il ramo «aperto» della pastiglia: la prova va riscritta').toBeTruthy();
    expect(pastiglia!).toMatch(/\btext-white\b/);
    expect(pastiglia!).toMatch(/\bbg-[a-z]+-\d{2,3}\b/);
  });

  it('il suo bianco si legge: almeno 4,5 contro lo sfondo', () => {
    const token = pastiglia!.match(/\bbg-([a-z]+-\d{2,3})\b/)![1];
    const colore = TAVOLOZZA[token];
    expect(colore, `il colore ${token} non è dichiarato in globals.css`).toBeTruthy();

    const misura = contrasto(colore, BIANCO);
    expect(
      misura,
      `«Aperto ora» è bianco su ${token} (${colore}): ${misura.toFixed(2)} contro i ${SOGLIA_TESTO} ` +
        `che servono a un testo. È la riga che dice al cliente se può ordinare adesso.`,
    ).toBeGreaterThanOrEqual(SOGLIA_TESTO);
  });
});

describe('e vale per ogni scritta bianca della vetrina, non solo per quella', () => {
  const coppie = tsxDellaVetrina().flatMap((f) =>
    coppieBiancoSuColore(readFileSync(join(SEZIONI, f), 'utf8'), f),
  );

  it('di scritte bianche su uno sfondo colorato ce ne sono davvero', () => {
    // Se la scansione smettesse di trovare niente, la prova sotto passerebbe
    // sempre. Oggi ne trova due: la pastiglia e la voce attiva del menu.
    expect(coppie.length, 'la scansione delle sezioni non trova più nessuna scritta bianca').toBeGreaterThanOrEqual(2);
  });

  it('nessuna sta su uno sfondo troppo chiaro', () => {
    const deboli = coppie
      .map((c) => ({ ...c, colore: TAVOLOZZA[c.sfondo], misura: TAVOLOZZA[c.sfondo] ? contrasto(TAVOLOZZA[c.sfondo], BIANCO) : null }))
      .filter((c) => c.misura !== null && c.misura < SOGLIA_TESTO);

    expect(
      deboli.map((c) => `${c.file}: testo bianco su ${c.sfondo} (${c.colore}) = ${c.misura!.toFixed(2)}`),
      `Serve almeno ${SOGLIA_TESTO} fra il testo e il suo sfondo (WCAG 2.1 — 1.4.3, livello AA). ` +
        `Il tono subito più scuro della stessa famiglia di solito basta.`,
    ).toEqual([]);
  });
});
