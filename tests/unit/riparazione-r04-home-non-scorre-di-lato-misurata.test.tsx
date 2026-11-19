import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium, type Browser } from '@playwright/test';

/**
 * R04-005 — La home scorreva di lato sul telefono col testo grande (360 px, testo al 200%).
 *
 * Questa prova MISURA: disegna le sezioni vere della home di default, compila il CSS con
 * tailwind.config.ts della repo, lo carica in Chromium e legge la larghezza della pagina.
 * Non cerca classi.
 *
 * Font: Fraunces e' quello del sito (app/Fraunces-ExtraBold.ttf, usato per TUTTI i pesi: l'ExtraBold
 * e' piu' largo del 700 e del 600, quindi misura il caso peggiore). Inter non e' nel deposito: si usa
 * quello di sistema se c'e', altrimenti il carattere di ripiego del sistema (di solito piu' largo).
 *
 * Il browser: se Chromium non si lancia la prova si salta DICHIARANDOLO (describe.skipIf, col motivo
 * scritto), come le prove col database vero (tests/unit/postgres-usa-e-getta.ts). Nella CI il lavoro
 * delle prove unitarie deve installare Chromium e fermarsi ROSSO se manca, come fa per PostgreSQL:
 * finché .github/workflows/ci.yml non lo fa, lì questa prova si salta (R04-005, serve_file_altrui).
 * ⚠️ Niente lib/errors ne' lib/zod-i18n qui dentro: non servono.
 */
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    JSON.stringify(queryKey).includes('liveFeed') || JSON.stringify(queryKey).includes('live')
      ? {
          data: [
            { created_at: new Date().toISOString(), delivery_status: 'DELIVERED', delivery_city: 'Piacenza', store_name: 'Panetteria Rossi' },
            { created_at: new Date().toISOString(), delivery_status: 'READY', delivery_city: 'Piacenza', store_name: 'Il Fruttivendolo' },
          ],
          isLoading: false,
          isError: false,
        }
      : { data: undefined, isLoading: false, isError: true },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

const ROOT = process.cwd();
let browser: Browser | null = null;
let css = '';
let sezioniHtml = '';

async function compilaCss(): Promise<string> {
  const globale = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const r = await postcss([tailwindcss({ config: join(ROOT, 'tailwind.config.ts') })]).process(globale, { from: join(ROOT, 'app/globals.css') });
  return r.css;
}

async function lanciaChromium(): Promise<{ browser: Browser | null; motivo: string }> {
  const tentativi: Array<Record<string, unknown>> = [{}];
  for (const p of [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium']) {
    if (p && existsSync(p)) tentativi.push({ executablePath: p });
  }
  const errori: string[] = [];
  for (const opz of tentativi) {
    try {
      return { browser: await chromium.launch({ headless: true, args: ['--no-sandbox'], ...opz }), motivo: '' };
    } catch (e) {
      errori.push(String((e as Error).message).split('\n')[0]);
    }
  }
  return {
    browser: null,
    motivo:
      `Chromium non si lancia (${errori.join(' | ')}). R04-005 misura la pagina in un browser vero: senza, si salta. ` +
      'Nella CI serve «npx playwright install --with-deps chromium» nel lavoro delle prove unitarie.',
  };
}

// Il browser si cerca subito, prima di raccogliere le prove: così il salto si decide e si dichiara qui.
const lancio = await lanciaChromium();
if (!lancio.browser) console.warn(`⚠️ ${lancio.motivo}`);

function paginaCon(html: string, fontSizeRadice: string): string {
  const fraunces = readFileSync(join(ROOT, 'app/Fraunces-ExtraBold.ttf')).toString('base64');
  return `<!doctype html><html lang="it" style="font-size:${fontSizeRadice}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 100 900; src: url(data:font/ttf;base64,${fraunces}) format('truetype'); }
:root { --font-inter: 'Inter'; --font-serif: 'Fraunces'; }
${css}
</style></head><body class="bg-cream-50 text-ink-900 font-sans antialiased">${html}</body></html>`;
}

async function prepara() {
  css = await compilaCss();
  const { default: HomeSectionRenderer } = await import('@/components/home-sections/HomeSectionRenderer');
  const { newHomeSection } = await import('@/lib/home-site');
  sezioniHtml = renderToStaticMarkup(
    createElement(HomeSectionRenderer, {
      // Le sezioni della home di default che il collaudo ha trovato larghe, tutte col loro
      // disegno vero. Le altre (prodotti, categorie, negozi) hanno bisogno del database.
      sections: (['liveActivity', 'howItWorks', 'trustRow', 'newsletter', 'sellerCta'] as const).map((t) => ({ ...newHomeSection(t), id: t })) as never,
      heroVariant: 'a',
      heroDefaults: { eyebrow: 'x', headline: 'x', subhead: 'x', ctaPrimary: 'x' } as never,
    }),
  );
  browser = lancio.browser;
}

async function misura(larghezza: number, fontSizeRadice: string) {
  const page = await browser!.newPage({ viewport: { width: larghezza, height: 800 } });
  try {
    await page.setContent(paginaCon(sezioniHtml, fontSizeRadice), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate((L) => {
      // Conta solo cio' che si vede davvero: un testo tagliato da un genitore con overflow nascosto
      // (la riga con i puntini) non allarga la pagina.
      const tagliato = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o !== 'visible') return true;
        }
        return false;
      };
      const sfora = Array.from(document.querySelectorAll('body *'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.width > 0 && r.right > L + 0.5 && !tagliato(el))
        .slice(0, 6)
        .map(({ el, r }) => `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') ?? '').slice(0, 80)}"> «${(el.textContent ?? '').trim().slice(0, 40)}» fino a ${Math.round(r.right)}px`);
      const link = Array.from(document.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes('Diventa venditore'));
      let righe = 0;
      if (link) {
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        const tops = new Set<number>();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!(n.textContent ?? '').trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const rc of Array.from(range.getClientRects())) tops.add(Math.round(rc.top));
        }
        righe = tops.size;
      }
      return {
        larghezzaPagina: document.documentElement.scrollWidth,
        frauncesCaricato: document.fonts.check('800 16px Fraunces'),
        sfora,
        righeDelPulsante: righe,
        trovatoIlPulsante: !!link,
      };
    }, larghezza);
  } finally {
    await page.close();
  }
}

describe.skipIf(!lancio.browser)('R04-005 · la home di default, misurata in Chromium', () => {
  beforeAll(prepara, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('a 360 px col testo al 200% la pagina non e\' piu\' larga dello schermo', async () => {
    const m = await misura(360, '200%');
    expect(m.frauncesCaricato, 'Fraunces non si e\' caricato: la misura non vale').toBe(true);
    if (process.env.MISURE) console.info('MISURA 360@200%', JSON.stringify(m));
    expect(m.larghezzaPagina, `scorre di lato. Fuori dallo schermo: ${m.sfora.join(' ; ')}`).toBeLessThanOrEqual(360);
  }, 60_000);

  it.each([640, 1024, 1280, 1366, 1440])('a %i px «Diventa venditore» sta su una riga', async (L) => {
    const m = await misura(L, '100%');
    expect(m.trovatoIlPulsante, 'la fascia per i negozi non e\' nella home di default').toBe(true);
    expect(m.righeDelPulsante, `«Diventa venditore» va a capo a ${L} px`).toBe(1);
    expect(m.larghezzaPagina).toBeLessThanOrEqual(L);
  }, 60_000);
});
