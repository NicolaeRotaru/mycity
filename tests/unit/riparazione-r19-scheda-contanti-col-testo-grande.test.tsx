/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined, warning: () => undefined }),
}));

const RADICE = path.resolve(__dirname, '../..');

describe('R19-007 · le schede dei metodi di pagamento si restringono col testo grande', () => {
  it('ogni contenuto di scheda (flex-1 dentro una label flex) ha min-w-0 e va a capo', () => {
    const src = readFileSync('components/checkout/PaymentMethodSelector.tsx', 'utf8');
    const blocchi = src.match(/<div className="[^"]*\bflex-1\b[^"]*">/g) ?? [];
    expect(blocchi.length).toBeGreaterThanOrEqual(3);
    for (const b of blocchi) {
      expect(b).toMatch(/\bmin-w-0\b/);
      expect(b).toMatch(/\bbreak-words\b/);
    }
  });
  it('resa: la scheda «Contanti alla consegna» ha il contenuto con min-w-0 e il badge può andare a capo', () => {
    const html = renderToStaticMarkup(
      <PaymentMethodSelector value="cod" onChange={() => {}} stripeAvailable multiSeller pickupInStore={false} onPickupChange={() => {}} pickupDiscount={0} pickupDiscountPercent={5} />,
    );
    const i = html.indexOf('Contanti alla consegna');
    const prima = html.slice(Math.max(0, i - 400), i);
    expect(prima).toMatch(/min-w-0[^"]*flex-1|flex-1[^"]*min-w-0/);
    expect(prima).toMatch(/flex-wrap/);
  });
  it('giro di correzione: il gruppo (fieldset) e il titolo «Contanti alla consegna» possono stringersi sotto il loro contenuto', () => {
    // Un <fieldset> per il browser ha min-width: min-content: senza min-w-0 si
    // allarga quanto la parola più lunga dentro e porta fuori tutta la pagina.
    const html = renderToStaticMarkup(
      <PaymentMethodSelector value="cod" onChange={() => {}} stripeAvailable multiSeller pickupInStore={false} onPickupChange={() => {}} pickupDiscount={0} pickupDiscountPercent={5} />,
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('fieldset')?.className ?? '').toMatch(/\bmin-w-0\b/);
    const titolo = [...doc.querySelectorAll('fieldset p')].find((p) => p.textContent === 'Contanti alla consegna');
    expect(titolo?.className ?? '').toMatch(/\bmin-w-0\b|overflow-wrap:anywhere/);
  });
  it('la colonna sinistra della cassa non si allarga oltre lo schermo (min-w-0)', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(src).toMatch(/<div className="min-w-0 lg:col-span-2 space-y-4">/);
  });
});

/**
 * Giro di correzione (13/11): le classi c'erano, ma misurata in Chromium col CSS
 * del progetto la pagina restava larga 444 px a 360, 375 e 390 px con il testo al
 * 200%. Qui si misura davvero: si monta la cassa vera (utente con un indirizzo
 * salvato, due negozi), se ne prende l'HTML, si compila il CSS col Tailwind del
 * progetto e lo si apre in Chromium, come un telefono col testo al massimo.
 */
const TROVA_CHROMIUM = String.raw`
const fs = require('fs');
const os = require('os');
const dove = [process.cwd(), os.tmpdir(), ...(process.env.NODE_PATH || '').split(':').filter(Boolean)];
let trovato = '';
for (const d of dove) {
  try {
    const r = require.resolve('playwright', { paths: [d] });
    if (fs.existsSync(require(r).chromium.executablePath())) { trovato = r; break; }
  } catch { /* qui non c'è: si prova il posto dopo */ }
}
`;

/** Il Playwright che ha davvero un Chromium da aprire: quello del progetto o quello della macchina. */
function playwrightConChromium(): string {
  try {
    return execFileSync(process.execPath, ['-e', TROVA_CHROMIUM + 'process.stdout.write(trovato);'], { cwd: RADICE, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}
const PLAYWRIGHT = playwrightConChromium();

const MISURA = TROVA_CHROMIUM + String.raw`
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const { chromium } = require(trovato);
let ingresso = '';
process.stdin.on('data', (d) => { ingresso += d; });
process.stdin.on('end', async () => {
  const { html, larghezze } = JSON.parse(ingresso);
  const css = (await postcss([tailwind({ config: 'tailwind.config.ts', content: [{ raw: html, extension: 'html' }] })])
    .process(fs.readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' })).css;
  const browser = await chromium.launch();
  const esiti = [];
  try {
    for (const w of larghezze) {
      const page = await browser.newPage({ viewport: { width: w, height: 844 } });
      await page.setContent('<!doctype html><html lang="it"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><style>html{font-size:200%} :root{--font-inter:\'Inter\'}</style></head><body><main>' + html + '</main></body></html>');
      const r = await page.evaluate(() => {
        const iw = window.innerWidth;
        const scheda = [...document.querySelectorAll('fieldset label')].find((l) => /Contanti alla consegna/.test(l.textContent || ''));
        const fuori = [...document.querySelectorAll('body *')]
          .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > iw + 0.5; })
          .slice(0, 5)
          .map((e) => e.tagName + ' «' + (e.textContent || '').trim().slice(0, 30) + '»');
        return { iw, sw: document.documentElement.scrollWidth, scheda: scheda ? Math.round(scheda.getBoundingClientRect().right) : null, fuori };
      });
      esiti.push({ w, ...r });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(JSON.stringify(esiti));
});
`;

const g = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const E = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
const P1 = { id: 'p-1', name: 'Filone di grano duro', price: 4, quantity: 1, sellerId: A, storeName: 'Forno A' };
const P2 = { id: 'p-2', name: 'Pasta di Gragnano', price: 3, quantity: 2, sellerId: E, storeName: 'Drogheria E' };
const GRUPPI = {
  groups: [
    { sellerId: A, storeName: 'Forno A', storeLat: 45.05, storeLng: 9.69, items: [P1] },
    { sellerId: E, storeName: 'Drogheria E', storeLat: 45.05, storeLng: 9.69, items: [P2] },
  ],
  orphans: [],
  stockIssues: [],
  variantIssues: [],
  prezziCambiati: [],
};
const IND = { id: 'ind-1', user_id: MARIA.id, full_name: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: null, lat: 45.052, lng: 9.7, is_default: true };

/**
 * Senza un Chromium sulla macchina (il lavoro «Unit tests» della CI non lo installa)
 * la misura si salta DICENDOLO, come le prove col PostgreSQL usa e getta; le classi
 * restano provate sopra, sempre.
 */
describe.skipIf(!PLAYWRIGHT)('R19-007 · misurata in Chromium: col testo al 200% la cassa non scorre di lato', () => {
  it('a 360, 375 e 390 px la pagina resta larga quanto lo schermo e la scheda dei contanti ci sta', async () => {
    localStorage.clear();
    localStorage.setItem('cart', JSON.stringify([P1, P2]));
    g.__UTENTE__ = MARIA;
    g.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
      const [chi] = o.queryKey;
      if (chi === 'checkout-groups') return GRUPPI;
      if (chi === 'auth-user') return MARIA;
      if (chi === 'user-addresses') return [IND];
      return undefined;
    };
    const pagina = (await monta('app/checkout/page.tsx')).default;
    const s = accendi(pagina, {});
    for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const html = s.radice.innerHTML;
    s.smonta();
    expect(html).toContain('Contanti alla consegna');
    expect(html).toContain('<fieldset');

    const esiti = JSON.parse(
      execFileSync(process.execPath, ['-e', MISURA], {
        cwd: RADICE,
        input: JSON.stringify({ html, larghezze: [360, 375, 390] }),
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString(),
    ) as Array<{ w: number; iw: number; sw: number; scheda: number | null; fuori: string[] }>;

    // Tutte e tre le larghezze in un solo confronto, così un rosso le mostra tutte.
    expect(esiti.map((e) => ({ w: e.w, larghezzaPagina: e.sw, fuori: e.fuori }))).toEqual(
      esiti.map((e) => ({ w: e.w, larghezzaPagina: e.iw, fuori: [] })),
    );
    for (const e of esiti) {
      expect(e.scheda, `a ${e.w} px non trovo la scheda dei contanti`).not.toBeNull();
      expect(e.scheda!).toBeLessThanOrEqual(e.iw);
    }
  }, 120000);
});
