/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { contrasto, daEsadecimale } from './aiuti/contrasto';
import { colore } from './aiuti/tavolozza-del-sito';

/**
 * IL CATALOGO SI LEGGE — ANCHE MENTRE SI STA AGGIORNANDO.
 *
 * 6/9/2026 — NOVE NUMERI DI CONTRASTO SCRITTI A MANO, ZERO PROVE CHE LI RIFACESSERO.
 *
 * Nel lotto di oggi ho contato nove commenti che dichiarano un rapporto di contrasto
 * («4,80», «6,7 volte», «5,00:1»). Erano tutti e nove giusti: le squadre il conto lo
 * sanno fare. Ma un numero scritto dentro un commento non diventa rosso se qualcuno
 * cambia il colore a cui si riferisce, e soprattutto non esiste per i colori che
 * nessuno ha pensato di misurare. I due difetti di stamattina sono esattamente quello:
 *
 *  · la griglia dei prodotti, mentre arrivavano i risultati di un filtro nuovo, si
 *    schiariva tutta a meta' opacita' lasciando le schede cliccabili. Una schiaritura
 *    sul contenitore mescola col fondo pagina OGNI cosa che sta dentro: il nome del
 *    prodotto scendeva da 15,9 a 3,3 volte il fondo, quello del negozio a 2,3, il «+»
 *    che mette nel carrello a 2,1. Nessuno l'aveva calcolato, perche' nessuno scrive
 *    `opacity-50` pensando «sto cambiando il colore di venti testi»;
 *  · le iniziali del negozio, ingrandite stamattina «cosi' la sigla si legge», ma
 *    lasciate bianche sopra un gradiente che partiva da `primary-500`: 3,79 volte,
 *    contro le 4,5 che servono a un testo di 10 pixel.
 *
 * Questa prova non controlla un colore. Controlla la REGOLA, su tre livelli, e ogni
 * numero lo rifa' dai colori veri di `tailwind.config.ts`:
 *
 *  ① monta la scheda prodotto VERA e misura ogni testo che si vede contro lo sfondo
 *    che ha davvero dietro, gradienti compresi (contro tutti e due i capi, e vince il
 *    peggiore). Un colore nuovo sotto soglia in una scheda di catalogo diventa rosso
 *    senza che nessuno debba aggiungere una riga qui;
 *  ② rilegge `ProductGrid.tsx` e cerca le schiariture che finiscono su un contenitore
 *    che AVVOLGE le schede. Per ognuna rifa' TUTTI i conti del punto ① mescolando i
 *    colori col fondo pagina a quell'opacita'. Se domani qualcuno rimette
 *    `opacity-50`, o ne prova una qualunque altra, questa prova dice quale testo cade
 *    e a quanto;
 *  ③ controlla che il segnale «sto aggiornando» che ha preso il posto della
 *    schiaritura si veda davvero: una riga che non stacca dal suo fondo non e' un
 *    segnale, e' un difetto travestito da rimedio.
 *
 * Le soglie sono quelle di WCAG 2.1 livello AA, che l'European Accessibility Act rende
 * obbligatorie in UE dal 28 giugno 2025: 4,5:1 per il testo normale (1.4.3), 3:1 per
 * le parti grafiche di un comando (1.4.11).
 *
 * ⚠️ COSA QUESTA PROVA NON VEDE. Non apre un browser: legge le classi che il
 * componente mette davvero a video e rifa' il conto sui token, che e' piu' preciso di
 * una stima a occhio ma non e' il pixel vero (ombre, foto sotto il testo, antialiasing).
 * E non sente niente: i lettori di schermo restano da provare con le orecchie.
 */

const RADICE = process.cwd();

/** Testo normale: WCAG 1.4.3, livello AA. */
const SOGLIA_TESTO = 4.5;
/** Parti grafiche di un comando: WCAG 1.4.11, livello AA. */
const SOGLIA_COMANDO = 3;

/** Il fondo della pagina: `bg-cream-100` sul <body>, in app/layout.tsx. */
const FONDO_PAGINA = () => colore('cream-100');

/* ────────────────────────────────────────────────────────────────────────────
 * I COLORI, COME LI VEDE UN OCCHIO
 * ──────────────────────────────────────────────────────────────────────────── */

const FUORI_TAVOLOZZA: Record<string, string> = { white: '#FFFFFF', black: '#000000' };

/** `bg-primary-600` → `#C0492C`; `text-white` → `#FFFFFF`. Null se non e' un colore. */
function coloreDi(classe: string, prefisso: 'bg-' | 'text-' | 'from-' | 'to-'): string | null {
  if (!classe.startsWith(prefisso)) return null;
  // Via le varianti (`hover:`, `disabled:`, `group-hover:`) — chi le usa le tratta a parte.
  const nudo = classe.slice(prefisso.length).split('/')[0];
  if (FUORI_TAVOLOZZA[nudo]) return FUORI_TAVOLOZZA[nudo];
  if (!/^[a-z]+-\d+$/.test(nudo)) return null;
  try {
    return colore(nudo);
  } catch {
    return null;
  }
}

/** L'opacita' scritta dopo la barra: `bg-white/95` → 0,95. Uno se non c'e'. */
function opacitaDellaClasse(classe: string): number {
  const m = classe.match(/\/(\d{1,3})$/);
  return m ? Number(m[1]) / 100 : 1;
}

/** Due colori mescolati: `sopra` a `alfa`, il resto e' `sotto`. Compositing sRGB. */
export function componi(sopra: string, sotto: string, alfa: number): string {
  const a = daEsadecimale(sopra);
  const b = daEsadecimale(sotto);
  const canale = (i: number) => Math.round(alfa * a[i] + (1 - alfa) * b[i]);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => canale(i).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

/** Le classi senza variante di stato: quelle che valgono sempre, appena e' a video. */
function classiFerme(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c && !c.includes(':'));
}

/**
 * Gli sfondi che un elemento ha DAVVERO dietro, dal piu' vicino al fondo pagina.
 * Un gradiente ne da' due (i suoi capi): il conto poi si fa su tutti e due e vince il
 * peggiore, perche' il testo sta sopra tutto il cerchio, non sopra un punto solo.
 */
function sfondiDietro(el: Element, fondo: string): string[] {
  let corrente: Element | null = el;
  let strati: string[] = [];
  while (corrente) {
    const classi = classiFerme(corrente);
    const capi = classi
      .map((c) => coloreDi(c, 'from-') ?? coloreDi(c, 'to-'))
      .filter((x): x is string => !!x);
    if (capi.length) {
      strati = capi;
      break;
    }
    const pieno = classi.find((c) => coloreDi(c, 'bg-'));
    if (pieno) {
      const hex = coloreDi(pieno, 'bg-')!;
      const alfa = opacitaDellaClasse(pieno);
      const sotto = sfondiDietro(corrente.parentElement ?? el.ownerDocument.body, fondo);
      strati = sotto.map((s) => (alfa < 1 ? componi(hex, s, alfa) : hex));
      break;
    }
    corrente = corrente.parentElement;
  }
  return strati.length ? strati : [fondo];
}

/** Il colore del testo: il suo, o quello ereditato dal primo antenato che lo dichiara. */
function coloreDelTesto(el: Element): string | null {
  let corrente: Element | null = el;
  while (corrente) {
    const trovato = classiFerme(corrente)
      .map((c) => coloreDi(c, 'text-'))
      .find((x): x is string => !!x);
    if (trovato) return trovato;
    corrente = corrente.parentElement;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * COSA C'E' DA MISURARE IN UNA SCHEDA DI CATALOGO
 * ──────────────────────────────────────────────────────────────────────────── */

type Misura = {
  /** Come si chiama per chi legge la prova diventata rossa. */
  cosa: string;
  davanti: string;
  dietro: string[];
  soglia: number;
};

/** Un comando spento non ha obblighi di contrasto: WCAG lo dice, e non e' una scusa. */
function spento(el: Element): boolean {
  return !!el.closest('[disabled], [aria-disabled="true"]');
}

/** Un testo che non si vede non ha un contrasto da rispettare. */
function invisibile(el: Element): boolean {
  return !!el.closest('.sr-only');
}

/** Tutto quello che, in una scheda montata, deve staccare da cio' che ha dietro. */
function daMisurare(radice: Element, fondo: string): Misura[] {
  const misure: Misura[] = [];

  // ① OGNI TESTO CHE SI VEDE.
  radice.querySelectorAll('*').forEach((el) => {
    const suo = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join(' ')
      .trim();
    if (!suo || spento(el) || invisibile(el)) return;
    const davanti = coloreDelTesto(el);
    if (!davanti) return;
    misure.push({
      cosa: `il testo «${suo.slice(0, 40)}» (${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(/\s+/)[0]})`,
      davanti,
      dietro: sfondiDietro(el, fondo),
      soglia: SOGLIA_TESTO,
    });
  });

  // ② LA SUPERFICIE DI OGNI COMANDO — il «+» che mette nel carrello sta qui.
  radice.querySelectorAll('button, a[href]').forEach((el) => {
    if (spento(el)) return;
    const pieno = classiFerme(el).find((c) => coloreDi(c, 'bg-'));
    if (!pieno) return;
    misure.push({
      cosa: `la superficie del comando «${el.getAttribute('aria-label') ?? el.tagName}» (${pieno})`,
      davanti: coloreDi(pieno, 'bg-')!,
      dietro: sfondiDietro(el.parentElement ?? radice, fondo),
      soglia: SOGLIA_COMANDO,
    });
  });

  return misure;
}

/** Il rapporto peggiore fra un colore e tutti gli sfondi che puo' avere dietro. */
function peggiore(m: Misura): { valore: number; dietro: string } {
  let valore = Infinity;
  let dietro = m.dietro[0];
  for (const s of m.dietro) {
    const r = contrasto(m.davanti, s);
    if (r < valore) {
      valore = r;
      dietro = s;
    }
  }
  return { valore, dietro };
}

const virgola = (n: number) => n.toFixed(2).replace('.', ',');

/** La scheda prodotto vera, con dentro tutto quello che una scheda puo' avere. */
async function schedaDiCatalogo() {
  const mod = await monta('components/ProductCard.tsx');
  return accendi(mod.default, {
    id: 'p1',
    name: 'Focaccia di Recco',
    price: 6.5,
    images: ['https://esempio.it/focaccia.jpg'],
    storeName: 'Pane Quotidiano',
    sellerId: 's1',
    discountPercent: 20,
    stock: 2,
    createdAt: new Date().toISOString(),
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * ① LA SCHEDA, FERMA
 * ──────────────────────────────────────────────────────────────────────────── */

describe('la scheda di un prodotto nel catalogo', () => {
  it('ogni testo e ogni comando stacca da quello che ha dietro', async () => {
    const s = await schedaDiCatalogo();
    const misure = daMisurare(s.radice, FONDO_PAGINA());

    expect(
      misure.length,
      'Dalla scheda prodotto non e\' uscito niente da misurare: il lettore delle classi si e\' rotto, non la scheda e\' diventata perfetta',
    ).toBeGreaterThan(6);

    const caduti = misure
      .map((m) => ({ m, ...peggiore(m) }))
      .filter((x) => x.valore < x.m.soglia)
      .map(
        (x) =>
          `${x.m.cosa}: ${x.m.davanti} su ${x.dietro} = ${virgola(x.valore)}:1, ne servono ${virgola(x.m.soglia)}`,
      );

    expect(
      caduti,
      `Nel catalogo c'e' del testo che chi vede poco non legge:\n  · ${caduti.join('\n  · ')}\n` +
        'Le soglie sono WCAG 2.1 AA (1.4.3 per il testo, 1.4.11 per i comandi), obbligatorie in UE ' +
        'dal 28/6/2025. I colori sono quelli veri di tailwind.config.ts: se ne hai cambiato uno, ' +
        'il conto e\' cambiato con lui.',
    ).toEqual([]);

    s.smonta();
  }, 60000);
});

/* ────────────────────────────────────────────────────────────────────────────
 * ② LA SCHEDA, MENTRE LA GRIGLIA SI AGGIORNA
 * ──────────────────────────────────────────────────────────────────────────── */

/** Il sorgente senza i commenti: qui dentro si parla di `opacity-50`, e non conta. */
function senzaCommenti(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Le schiariture che la griglia mette su un contenitore SEMPRE, appena quel
 * contenitore e' a video. Le varianti di stato (`disabled:opacity-50` sul pulsante
 * «Carica altri prodotti») restano fuori apposta: un comando spento e' l'unica cosa
 * che WCAG esenta davvero dal contrasto.
 */
function schiaritureDellaGriglia(): number[] {
  const src = senzaCommenti(readFileSync(join(RADICE, 'components/ProductGrid.tsx'), 'utf8'));
  const trovate = new Set<number>();
  for (const m of src.matchAll(/([a-z-]+:)?opacity-(\d{1,3})\b/g)) {
    if (m[1]) continue; // ha una variante davanti: vale solo in quello stato
    trovate.add(Number(m[2]) / 100);
  }
  return [...trovate];
}

describe('la griglia dei prodotti mentre arrivano i risultati di un filtro nuovo', () => {
  it('non schiarisce le schede che restano a schermo', async () => {
    const schiariture = schiaritureDellaGriglia();
    const s = await schedaDiCatalogo();
    const fondo = FONDO_PAGINA();
    const misure = daMisurare(s.radice, fondo);

    const caduti: string[] = [];
    for (const alfa of schiariture) {
      for (const m of misure) {
        const davanti = componi(m.davanti, fondo, alfa);
        const dietro = m.dietro.map((d) => componi(d, fondo, alfa));
        const p = peggiore({ ...m, davanti, dietro });
        if (p.valore < m.soglia) {
          caduti.push(
            `con opacity-${Math.round(alfa * 100)} → ${m.cosa}: ${virgola(p.valore)}:1 invece di ${virgola(contrasto(m.davanti, m.dietro[0]))}:1, ne servono ${virgola(m.soglia)}`,
          );
        }
      }
    }

    expect(
      caduti,
      'components/ProductGrid.tsx schiarisce un contenitore che avvolge le schede, e sotto quella ' +
        'schiaritura il catalogo smette di leggersi:\n  · ' +
        caduti.slice(0, 8).join('\n  · ') +
        `\n  (${caduti.length} in tutto)\n` +
        'Una schiaritura su un contenitore non tocca solo lo sfondo: mescola col fondo pagina OGNI ' +
        'cosa che sta dentro, testi e pulsanti compresi. Se serve dire «sto aggiornando», dillo con ' +
        'qualcosa che si aggiunge — una riga, un\'etichetta — non spegnendo quello che c\'e\' gia\'.',
    ).toEqual([]);

    s.smonta();
  }, 60000);
});

/* ────────────────────────────────────────────────────────────────────────────
 * ③ IL SEGNALE CHE HA PRESO IL POSTO DELLA SCHIARITURA
 * ──────────────────────────────────────────────────────────────────────────── */

describe('il segno che la griglia si sta aggiornando', () => {
  it('si vede: stacca dal proprio fondo almeno quanto un comando', () => {
    const src = senzaCommenti(readFileSync(join(RADICE, 'components/ProductGrid.tsx'), 'utf8'));
    const barra = src.match(/function BarraSiAggiorna[\s\S]*?\n}/);
    expect(
      barra,
      'In components/ProductGrid.tsx non c\'e\' piu\' BarraSiAggiorna: se il segnale visivo di ' +
        '«sto aggiornando» e\' cambiato forma, questa prova va riscritta insieme a lui — non tolta.',
    ).toBeTruthy();

    const classi = [...barra![0].matchAll(/(?:bg|text)-[a-z]+-\d+/g)].map((m) => m[0]);
    const sfondi = classi.filter((c) => c.startsWith('bg-')).map((c) => coloreDi(c, 'bg-')!);
    expect(
      sfondi.length,
      `La riga di «sto aggiornando» non dichiara piu' due fondi (la pista e la barra): ${classi.join(', ')}`,
    ).toBe(2);

    const [pista, riempimento] = sfondi;
    const staccoDallaPista = contrasto(riempimento, pista);
    const staccoDallaPagina = contrasto(pista, FONDO_PAGINA());

    expect(
      staccoDallaPista,
      `La barra di avanzamento (${riempimento}) sulla sua pista (${pista}) stacca ${virgola(staccoDallaPista)}:1: ` +
        'sotto le 3 volte non e\' un segnale, e\' una sfumatura. Chi vede poco tocca un filtro e non ' +
        'sa se il sito ha preso.',
    ).toBeGreaterThanOrEqual(SOGLIA_COMANDO);

    expect(
      staccoDallaPagina,
      `La pista della barra (${pista}) sul fondo pagina (${FONDO_PAGINA()}) stacca solo ${virgola(staccoDallaPagina)}:1: ` +
        'la riga comparirebbe senza che si veda comparire.',
    ).toBeGreaterThan(1.05);
  });
});
