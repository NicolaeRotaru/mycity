/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { monta } from './aiuti/monta-componente';
import { contrasto } from './aiuti/contrasto';

/**
 * 3/9/2026 — I BORDI DEI CAMPI DA COMPILARE NON SI VEDEVANO: CREMA SU CREMA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Il bordo di ogni campo era `border-cream-300` (#EEDFBA) e la pagina dietro è cream-100 (#FBF7F0).
 * Misurato in un browser su /sign-in: staccava 1,24 volte. Per il bordo di un comando WCAG 2.1
 * (1.4.11, livello AA) ne chiede 3. Chi ha la vista calante — l'anziano di Piacenza che ordina il
 * pane — non vedeva dove scrivere: vedeva un rettangolo di crema su crema. Vale per l'accesso, la
 * registrazione, l'indirizzo di consegna in cassa, i moduli dell'area venditore.
 *
 * ── La radice ───────────────────────────────────────────────────────────────────────────────────
 * cream-300 è il colore dei SEPARATORI decorativi, riusato come bordo dei comandi. Due tinte
 * vicine della stessa rampa non possono arrivare a 3:1: non è un valore da ritoccare di un filo, è
 * il colore sbagliato per quel mestiere. Da qui il token `--border-control`, separato da `--border`.
 *
 * ── Cosa prova questo file, e perché non cerca una classe ───────────────────────────────────────
 * Legge la classe di bordo che la primitiva `components/ui/Field.tsx` usa DAVVERO, monta le regole
 * vere di `app/globals.css` in un browser finto, chiede al motore del foglio di stile che colore
 * esce alla fine, e RIFÀ IL CONTO del contrasto sui colori veri di `tailwind.config.ts`.
 *
 * Cercare la parola «border-ink-400» non proverebbe niente: chiunque riscrivesse la stessa regola
 * con un altro nome — o cambiasse la classe dentro Field — passerebbe lo stesso, col campo di nuovo
 * invisibile. Qui invece si rompe: se la regola non copre più la classe della primitiva, il colore
 * che esce torna quello decorativo e il conto scende sotto 3.
 *
 * ⚠️ Cosa NON prova: il resto della pagina. Il conto è fatto contro i due fondi su cui un campo si
 * appoggia davvero (il fondo pagina e il bianco della card). Un campo messo sopra una foto o sopra
 * un blocco colorato non è misurato da qui.
 */

/** La soglia di WCAG 2.1 (1.4.11) per le parti grafiche di un comando. */
const SOGLIA_COMANDO = 3;

const GLOBALS = readFileSync('app/globals.css', 'utf8');
const FIELD = readFileSync('components/ui/Field.tsx', 'utf8');

/** I due fondi su cui un campo si appoggia: la pagina e il bianco delle card. */
const FONDI = [
  { nome: 'il fondo della pagina (cream-100)', hex: '#FBF7F0' },
  { nome: 'il bianco di una card', hex: '#FFFFFF' },
];

type Tavolozza = Record<string, Record<string, string>>;
let colori: Tavolozza;

beforeAll(async () => {
  const mod = await monta('tailwind.config.ts');
  const config = mod.default as { theme?: { extend?: { colors?: Tavolozza } } };
  colori = config.theme?.extend?.colors ?? {};
}, 60000);

/** Da `border-cream-300` al colore vero della tavolozza. */
function coloreDi(classe: string): string | null {
  const m = classe.match(/^border-([a-z]+)-(\d+)$/);
  if (!m) return null;
  return colori[m[1]]?.[m[2]] ?? null;
}

/** Le classi di bordo che la primitiva dei campi mette davvero sul controllo, a riposo. */
function bordiDellaPrimitiva(): string[] {
  const base = FIELD.match(/const CONTROL_OK\s*=\s*'([^']*)'/);
  expect(base, 'in Field.tsx non c\'è più CONTROL_OK: la primitiva è cambiata forma, la prova va riscritta').toBeTruthy();
  const classi = base![1].split(/\s+/).filter((c) => /^border-[a-z]+-\d+$/.test(c));
  expect(classi.length, `in CONTROL_OK non trovo nessuna classe di bordo: «${base![1]}»`).toBeGreaterThan(0);
  return classi;
}

/**
 * Mette in piedi il foglio di stile vero e chiede al browser finto che bordo esce.
 *
 * Le utility di Tailwind non stanno in nessun file (le genera il compilatore), quindi si scrivono
 * qui a partire dai colori VERI della tavolozza: è la stessa dichiarazione che genererebbe
 * Tailwind, con lo stesso peso (una classe).
 */
function coloreCheEsce(tag: 'input' | 'textarea' | 'select', classi: string[]): string {
  const utility = classi
    .map((c) => `.${c.replace(/([^\w-])/g, '\\$1')} { border-color: ${coloreDi(c)}; }`)
    .join('\n');
  document.head.innerHTML = `<style>${risolviVariabili(senzaTailwind(GLOBALS))}\n${utility}</style>`;
  document.body.innerHTML = `<${tag} class="${classi.join(' ')}"></${tag}>`;
  const el = document.body.firstElementChild!;
  return getComputedStyle(el).borderColor || getComputedStyle(el).getPropertyValue('border-top-color');
}

/** Via le direttive `@tailwind`, che sono un ordine per il compilatore e non regole CSS. */
function senzaTailwind(css: string): string {
  return css.replace(/@tailwind[^;]*;/g, '');
}

/**
 * Sostituisce i `var(--x)` col loro valore, come farebbe il browser.
 *
 * Il browser finto non sa risolvere le variabili CSS: se una regola dice `border-color:
 * var(--border-control)`, lui la butta via e vince la utility. Qui le variabili si leggono dal
 * blocco `:root` del foglio VERO — comprese le catene, `--border-control` che punta a `--ink-400`
 * che porta il colore — e si sostituiscono nel testo prima di darlo in pasto al browser finto.
 *
 * Resta una prova sensibile: se domani `--border-control` puntasse di nuovo al colore decorativo,
 * la sostituzione porterebbe quel colore e il conto scenderebbe sotto la soglia.
 */
function risolviVariabili(css: string): string {
  const radice = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  expect(radice, 'in globals.css non c\'è più il blocco :root: la prova va riscritta').toBeTruthy();
  const valori: Record<string, string> = {};
  for (const m of radice![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) valori[m[1]] = m[2].trim();

  const risolvi = (v: string, giri = 0): string => {
    if (giri > 10) return v;
    const dopo = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, nome, ripiego) =>
      valori[nome] ?? (ripiego ?? '').trim(),
    );
    return dopo === v ? v : risolvi(dopo, giri + 1);
  };

  return css.replace(/var\([^;{}]*?\)/g, (v) => risolvi(v));
}

/** Da `rgb(120, 113, 108)` a `#78716C`. */
function inEsadecimale(colore: string): string {
  const m = colore.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return colore.trim();
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

describe('il metro si legge davvero dai file (se no non sta misurando niente)', () => {
  it('la tavolozza vera risponde', () => {
    expect(colori.cream?.['300'], 'la tavolozza non ha più cream-300').toBe('#EEDFBA');
    expect(colori.ink?.['400'], 'la tavolozza non ha più ink-400').toBe('#78716C');
  });

  it('il colore decorativo da solo NON basterebbe: è il difetto, in numeri', () => {
    const misura = contrasto('#EEDFBA', '#FBF7F0');
    expect(
      misura,
      'cream-300 sul fondo pagina è arrivato sopra i 3:1: la tavolozza è cambiata e questa prova ' +
        'non sta più guardando il difetto che doveva sorvegliare',
    ).toBeLessThan(SOGLIA_COMANDO);
  });
});

describe('il bordo di un campo da compilare stacca abbastanza da vedersi', () => {
  for (const tag of ['input', 'textarea', 'select'] as const) {
    it(`il bordo di un <${tag}> arriva a ${SOGLIA_COMANDO}:1 su ogni fondo`, () => {
      const classi = bordiDellaPrimitiva();
      const esce = inEsadecimale(coloreCheEsce(tag, classi));
      expect(esce, `dal foglio di stile non esce nessun colore di bordo per <${tag}>`).toMatch(/^#[0-9a-f]{6}$/i);

      for (const fondo of FONDI) {
        const misura = contrasto(esce, fondo.hex);
        expect(
          misura,
          `il bordo di un <${tag}> esce ${esce} (dalle classi «${classi.join(' ')}») e su ${fondo.nome} ` +
            `stacca ${misura.toFixed(2)} volte: ne servono ${SOGLIA_COMANDO}. Chi ha poca vista non ` +
            'vede dove deve scrivere — e il modulo sta fra il cliente e l\'ordine pagato.',
        ).toBeGreaterThanOrEqual(SOGLIA_COMANDO);
      }
    });
  }

  it('e il bordo del fuoco resta quello del fuoco (la cura non lo schiaccia)', () => {
    const fuoco = FIELD.match(/focus-visible:border-([a-z]+-\d+)/);
    expect(fuoco, 'in Field.tsx non c\'è più il bordo del fuoco: la prova va riscritta').toBeTruthy();
    const hex = coloreDi(`border-${fuoco![1]}`);
    expect(hex, `il colore del fuoco «${fuoco![1]}» non sta nella tavolozza`).toBeTruthy();
    const misura = contrasto(hex!, '#FFFFFF');
    expect(
      misura,
      `il bordo del fuoco è ${fuoco![1]} (${hex}) e su bianco stacca ${misura.toFixed(2)} volte: chi ` +
        'naviga da tastiera non vede dove si trova',
    ).toBeGreaterThanOrEqual(SOGLIA_COMANDO);
  });
});
