/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 — IL SITO GIÀ PRONTO, APPENA IL TITOLARE APRE IL LINK DEL VENDITORE.
 * Nicola: «mettilo nel momento in cui l'imprenditore ha cliccato sul link che gli ha inviato il venditore di
 * MyCity» → «il sito nella pagina del link». Sopra i tre abbonamenti il titolare vede il suo sito; la pagina è
 * aperta a chi ha il link, quindi del lavoro consegnato passa solo il sito.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('404'); }, redirect: (u: string) => { throw new Error(`redirect ${u}`); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: () => ({ select: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }) }) }),
}));
const demo = vi.hoisted(() => ({ sellerId: '429d0e22-4b3f-40db-8f81-ab331701fb81' }));
vi.mock('@/lib/agenzia/demo-dal-link', () => ({
  leggiDemoDalLink: async () => ({
    tipo: 'aperto',
    pc: { sellerId: demo.sellerId, fasciaScelta: 'business' },
    preventivo: { numero: '2026-0042', attivita: 'Caffè di Piacenza', tipoAttivita: 'bar', consigliato: 'business', primoMeseScontato: true, prezzi: { base: 30000, business: 60000, premium: 90000 } },
    scheda: null,
  }),
}));

import { SitoSchema, type Sito } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { sitoConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';
import { CAFFE_DI_PIACENZA_ID } from '@/lib/agenzia/lavoro-consegnato/siti';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import SitoPronto from '@/components/seller/lavoro-consegnato/SitoPronto';
import ConfermaDalLink from '@/app/preventivo/[codice]/page';

const CODICE = '576b7b83a2480b14678b96cc9009a95d15f68385941e7f56eb4546265315b521';
const apriIlLink = async () =>
  renderToStaticMarkup(await ConfermaDalLink({ params: Promise.resolve({ codice: CODICE }), searchParams: Promise.resolve({}) }));

describe('la pagina del link mostra il sito già pronto', () => {
  afterEach(() => { demo.sellerId = CAFFE_DI_PIACENZA_ID; });

  it('il titolare del Caffè apre il link e, sopra gli abbonamenti, vede il suo sito', async () => {
    const html = await apriIlLink();
    expect(html).toContain('Il sito di Caffè di Piacenza è già pronto');
    expect(html).toContain('src="/lavoro-consegnato/caffe-di-piacenza/home.jpg"');
    expect(html.indexOf('è già pronto')).toBeLessThan(html.indexOf('Confermo'));
  });

  it('un negozio senza sito fatto vede la pagina di sempre', async () => {
    demo.sellerId = '8bbc42b0-f56d-4da4-a567-9ceb0261b7f1';
    const html = await apriIlLink();
    expect(html).not.toContain('è già pronto');
    expect(html).toContain('ecco il tuo abbonamento');
  });
});

describe('del lavoro consegnato, al link arriva solo il sito', () => {
  it('Caffè: il sito con la sua anteprima; SDG: il sito, mai analisi o piano social', () => {
    expect(sitoConsegnatoDi(CAFFE_DI_PIACENZA_ID)?.anteprima).toBe('/lavoro-consegnato/caffe-di-piacenza/home.jpg');
    const sdg = sitoConsegnatoDi(SDG_SELLER_ID) as Record<string, unknown> | null;
    expect(sdg).not.toBeNull();
    for (const chiave of ['swot', 'concorrenti', 'calendario', 'pilastri', 'analisi', 'social']) expect(sdg).not.toHaveProperty(chiave);
    expect(sitoConsegnatoDi('qualcun-altro')).toBeNull();
  });

  it("l'anteprima è solo un'immagine del sito MyCity, e quella del Caffè esiste davvero", () => {
    const base = SitoSchema.parse({ titolo: 't', aggiornato_il: 'x', stato: 'da_pubblicare' });
    expect(SitoSchema.safeParse({ ...base, anteprima: '/lavoro-consegnato/caffe-di-piacenza/home.jpg' }).success).toBe(true);
    for (const cattiva of ['https://altrove.it/home.jpg', '//altrove.it/home.jpg', '/lavoro-consegnato/../segreti/x.jpg', '/altro/x.jpg', '/lavoro-consegnato/caffe/home.svg', 'javascript:alert(1)']) {
      expect(SitoSchema.safeParse({ ...base, anteprima: cattiva }).success, cattiva).toBe(false);
    }
    expect(existsSync(path.resolve(__dirname, '../../public/lavoro-consegnato/caffe-di-piacenza/home.jpg'))).toBe(true);
  });
});

describe('il riquadro «Il tuo sito è già pronto»', () => {
  let root: Root | null = null;
  let box: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; });
  const monta = (sito: Sito) => {
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    act(() => root!.render(createElement(SitoPronto, { sito, attivita: 'Caffè di Piacenza' })));
    return box;
  };
  const base = sitoConsegnatoDi(CAFFE_DI_PIACENZA_ID)!;

  it('non ancora online: la prima pagina in immagine, le pagine e cosa controllare insieme', () => {
    const el = monta({ ...base, stato: 'da_pubblicare', indirizzo: null });
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/lavoro-consegnato/caffe-di-piacenza/home.jpg');
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.textContent).toContain('5 pagine');
    expect(el.textContent).toContain('Niente va online senza il tuo sì');
  });

  it('online: il sito dal vivo, con lo stesso permesso stretto del riquadro', () => {
    const el = monta({ ...base, stato: 'online', indirizzo: 'https://caffe-di-piacenza.vercel.app' });
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('https://caffe-di-piacenza.vercel.app');
    expect(el.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(el.querySelector('a[href="https://caffe-di-piacenza.vercel.app"]')).not.toBeNull();
  });

  it('senza anteprima e non online: niente riquadro vuoto', () => {
    const el = monta({ ...base, stato: 'da_pubblicare', indirizzo: null, anteprima: null });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.textContent).toContain('è già pronto');
  });
});
