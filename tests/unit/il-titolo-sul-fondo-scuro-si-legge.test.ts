/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { monta } from './aiuti/monta-componente';
import { contrasto } from './aiuti/contrasto';

/**
 * 3/9/2026 — SUL RIQUADRO SCURO IL TITOLO RESTAVA NERO E LA RIGA SOTTO DIVENTAVA BIANCA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * In `app/globals.css` la regola `h1, h2, h3 { color: … }` dà ai titoli un colore PROPRIO
 * (ink-900, quasi nero). Quando il riquadro che li contiene dichiara `text-white`, quel bianco si
 * trasmette solo per eredità — e l'eredità perde sempre contro una dichiarazione scritta
 * sull'elemento. Risultato: il titolo restava nero mentre il sottotitolo accanto diventava bianco.
 *
 * Misurato in un browser su /about: l'H1 «Il quartiere, a portata di mano.» usciva rgb(28,26,24)
 * sopra il gradiente terracotta, cioè circa 2,6 volte di stacco contro le 3 che WCAG 2.1 (1.4.3,
 * livello AA) chiede anche al testo grande. Lo stesso schema si ripete in una ventina di titoli:
 * il banner della home, il banner della vetrina del negozio, il nome del negozio in cima al
 * pannello venditore.
 *
 * ── La malattia, non il punto ───────────────────────────────────────────────────────────────────
 * Non è l'errore di una pagina: è una trappola di sistema. Ogni titolo nuovo dentro un blocco
 * scuro nasceva sbagliato allo stesso modo. Aggiungere `text-white` ai diciannove cura quei
 * diciannove e non il ventesimo. La cura sta in una riga sola del foglio di stile: dentro un blocco
 * che dichiara il proprio colore, il titolo torna a ereditarlo.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────────
 * Monta le regole VERE di `app/globals.css` in un browser finto, ci mette dentro il riquadro come
 * lo scrive il progetto, chiede al motore del foglio di stile che colore esce alla fine e RIFÀ IL
 * CONTO del contrasto contro i colori veri di `tailwind.config.ts`. Tre controlli, perché una cura
 * larga farebbe danni altrove:
 *
 *   ① dentro un blocco che dichiara il bianco, il titolo si legge (≥ 3:1 sul fondo scuro);
 *   ② un titolo che dichiara un colore SUO se lo tiene: la cura non glielo ruba;
 *   ③ su una pagina chiara il titolo resta del colore dei titoli: la cura non deborda.
 *
 * E un censimento: conta nei file veri quanti titoli stanno dentro un blocco a testo chiaro senza
 * un colore proprio. Se domani fossero zero, questa prova starebbe sorvegliando un meccanismo che
 * non usa più nessuno, e lo dice invece di restare verde per finta.
 *
 * ⚠️ Cosa NON prova: quale sia il fondo vero sotto ogni titolo. Il conto è fatto contro i due
 * estremi del gradiente usato davvero da /about (primary-700 → secondary-700). Un banner con una
 * foto scura caricata dal negoziante resta da guardare con l'occhio.
 */

/** La soglia di WCAG 2.1 (1.4.3) per il testo grande — un titolo è testo grande. */
const SOGLIA_TESTO_GRANDE = 3;

const RADICE = process.cwd();
const GLOBALS = readFileSync('app/globals.css', 'utf8');

type Tavolozza = Record<string, Record<string, string>>;
let colori: Tavolozza;

beforeAll(async () => {
  const mod = await monta('tailwind.config.ts');
  const config = mod.default as { theme?: { extend?: { colors?: Tavolozza } } };
  colori = config.theme?.extend?.colors ?? {};
}, 60000);

/** Via le direttive `@tailwind`: sono un ordine per il compilatore, non regole CSS. */
function senzaTailwind(css: string): string {
  return css.replace(/@tailwind[^;]*;/g, '');
}

/**
 * Sostituisce i `var(--x)` col loro valore, come farebbe il browser: il browser finto le variabili
 * CSS non le risolve, e butterebbe via proprio le regole che qui bisogna misurare. I valori si
 * leggono dal blocco `:root` del foglio VERO, catene comprese.
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

/** Da `text-white` / `text-red-900` alla dichiarazione che genererebbe Tailwind. */
function utilityDelColore(classe: string): string {
  if (classe === 'text-white') return `.text-white { color: #FFFFFF; }`;
  const m = classe.match(/^text-([a-z]+)-(\d+)$/);
  const hex = m ? colori[m[1]]?.[m[2]] : null;
  expect(hex, `non conosco il colore della classe «${classe}»`).toBeTruthy();
  return `.${classe} { color: ${hex}; }`;
}

/** Il colore che esce davvero da un titolo, montando il foglio di stile vero. */
function coloreDelTitolo(tag: string, classiContenitore: string, classiTitolo = ''): string {
  const utility = [classiContenitore, classiTitolo]
    .join(' ')
    .split(/\s+/)
    .filter((c) => c.startsWith('text-') && !/^text-(xs|sm|base|lg|xl|\dxl|left|center|right)$/.test(c))
    .map(utilityDelColore)
    .join('\n');
  document.head.innerHTML = `<style>${risolviVariabili(senzaTailwind(GLOBALS))}\n${utility}</style>`;
  document.body.innerHTML =
    `<div class="${classiContenitore}"><${tag} class="${classiTitolo}">Il quartiere, a portata di mano.</${tag}></div>`;
  const el = document.body.querySelector(tag)!;
  return inEsadecimale(getComputedStyle(el).color);
}

function inEsadecimale(colore: string): string {
  const m = colore.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return colore.trim().toUpperCase();
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('').toUpperCase();
}

describe('un titolo dentro un blocco a testo chiaro si legge', () => {
  /** I due estremi del gradiente che /about usa davvero sotto il suo titolo. */
  const fondi = () => [
    { nome: 'primary-700', hex: colori.primary['700'] },
    { nome: 'secondary-700', hex: colori.secondary['700'] },
  ];

  for (const tag of ['h1', 'h2', 'h3']) {
    it(`<${tag}> dentro un blocco «text-white» stacca dal fondo scuro`, () => {
      const esce = coloreDelTitolo(tag, 'bg-gradient-to-br from-primary-700 to-secondary-700 text-white');
      for (const fondo of fondi()) {
        const misura = contrasto(esce, fondo.hex);
        expect(
          misura,
          `il <${tag}> dentro un riquadro che dichiara il bianco esce ${esce}: su ${fondo.nome} ` +
            `(${fondo.hex}) stacca ${misura.toFixed(2)} volte, ne servono ${SOGLIA_TESTO_GRANDE}. ` +
            'È il titolo più grosso della pagina, ed è il pezzo meno leggibile: due righe accanto, ' +
            'una bianca e una nera, sullo stesso fondo.',
        ).toBeGreaterThanOrEqual(SOGLIA_TESTO_GRANDE);
      }
    });
  }

  it('ma un titolo che dichiara un colore SUO se lo tiene', () => {
    const esce = coloreDelTitolo('h3', 'bg-olive-600 text-white', 'font-bold text-secondary-900');
    expect(
      esce,
      'la cura ha rubato il colore a un titolo che ne dichiarava uno suo: una regola che deborda ' +
        'rompe le pagine che erano a posto',
    ).toBe(colori.secondary['900'].toUpperCase());
  });

  it('e su una pagina chiara il titolo resta del colore dei titoli', () => {
    const esce = coloreDelTitolo('h2', 'bg-white p-4');
    const atteso = colori.ink['900'].toUpperCase();
    expect(
      esce,
      `su un fondo chiaro il titolo esce ${esce} invece di ${atteso}: la cura è debordata fuori dai ` +
        'blocchi scuri',
    ).toBe(atteso);
  });
});

describe('il censimento: quanti titoli si appoggiano davvero a questo meccanismo', () => {
  function fileJsx(cartella: string, dentro: string[] = []): string[] {
    for (const voce of readdirSync(cartella)) {
      if (voce === 'node_modules' || voce === '.next' || voce === '.git') continue;
      const p = join(cartella, voce);
      if (statSync(p).isDirectory()) fileJsx(p, dentro);
      else if (p.endsWith('.tsx')) dentro.push(p);
    }
    return dentro;
  }

  it('ce ne sono, quindi la regola sopra non sorveglia il vuoto', () => {
    const files = [...fileJsx(join(RADICE, 'app')), ...fileJsx(join(RADICE, 'components'))];
    const chiaro = /(?:^|\s)(?:[a-z0-9-]+:)?text-white(?:\/\d+)?(?![\w-])/;
    const coloreProprio = /(?:^|\s)(?:[a-z0-9-]+:)?text-(?:white|black|[a-z]+-\d+)(?:\/\d+)?(?![\w-])/;
    let quanti = 0;
    for (const f of files) {
      const righe = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < righe.length; i++) {
        const c = righe[i].match(/className="([^"]*)"/);
        if (!c || !chiaro.test(c[1])) continue;
        for (let j = i + 1; j < Math.min(righe.length, i + 20); j++) {
          if (!/<h[123]\b/.test(righe[j])) continue;
          const cl = (righe[j].match(/className="([^"]*)"/) ?? [])[1] ?? '';
          if (!coloreProprio.test(cl)) quanti++;
          break;
        }
      }
    }
    expect(
      quanti,
      'nel progetto non c\'è più nessun titolo dentro un blocco a testo chiaro: la regola di ' +
        'globals.css non serve più a nessuno, e questa prova sta guardando il vuoto',
    ).toBeGreaterThan(0);
  });
});
