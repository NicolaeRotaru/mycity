// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 30/10/2026 — LE SCHEDE DEI NEGOZI DICONO «CONSEGNA OGGI» SOLO SE OGGI UNA CONSEGNA SI PUÒ ANCORA FARE.
 *
 * Il caso vero: giovedì 29/10 alle 20:15 Pane Quotidiano era chiuso dalle 13. La vetrina del negozio
 * lo diceva già giusto (`consegnaDellaVetrina`, ondata 16), ma le altre tre schede no:
 *   · la riga dell'elenco dei negozi (components/StoreListRow.tsx, usata in app/near) scriveva
 *     «consegna oggi» sempre, senza nessuna condizione;
 *   · la scheda della vetrina in home (components/StorePreviewCard.tsx) e il negozio in evidenza
 *     (components/home/HeroStoreCard.tsx) lo deducevano da «aperto adesso»: alle 9 col forno aperto
 *     dicevano «consegna oggi» anche senza fattorino, quando le fasce del pomeriggio cadono a forno
 *     chiuso e la cassa non ha niente da offrire per oggi.
 * Adesso tutte e tre chiedono la stessa regola della vetrina e della cassa (registro dei fatti,
 * consegna.promessa): una fascia di oggi ancora aperta per gli orari del negozio, o il sì della cassa
 * alla veloce.
 *
 * Qui anche due buchi della vetrina stessa:
 *   · mentre aspetta la risposta della veloce, o se la risposta cade, scriveva «Consegna domani» per
 *     poi passare a «Consegna oggi»: finché non sa, non scrive un giorno;
 *   · un sì vecchio della veloce non deve tenere «oggi» dopo le 21, anche con un negozio aperto la
 *     sera (le prove di prima usavano solo il forno, che chiude alle 19:30).
 */

const { FORNO, SERA, NEGOZIO } = vi.hoisted(() => {
  /** Pane Quotidiano: il giovedì chiude alle 13, il venerdì riapre la mattina. */
  const FORNO = {
    mon: [['07:00', '13:00'], ['16:00', '19:30']],
    tue: [['07:00', '13:00'], ['16:00', '19:30']],
    wed: [['07:00', '13:00'], ['16:00', '19:30']],
    thu: [['07:00', '13:00']],
    fri: [['07:00', '13:00'], ['16:00', '19:30']],
    sat: [['07:00', '13:00']],
  };
  /** Un negozio aperto tutti i giorni dalle 8 alle 23: la sera è aperto, la veloce no. */
  const tutto = [['08:00', '23:00']];
  const SERA = { mon: tutto, tue: tutto, wed: tutto, thu: tutto, fri: tutto, sat: tutto, sun: tutto };
  const NEGOZIO = {
    id: 'pane-quotidiano',
    store_name: 'Pane Quotidiano',
    store_address: 'Via Roma 1, Piacenza',
    store_logo: null,
    store_hours: FORNO,
    store_media: [],
  };
  return { FORNO, SERA, NEGOZIO };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: () => {}, push: () => {} }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/StoreStoryRing', () => ({ default: ({ children }: { children?: ReactNode }) => children ?? null }));
vi.mock('@/components/StoreMediaCarousel', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: { store: NEGOZIO, products: [], reviews: null }, error: null }) },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Ottobre 2026 a Piacenza: dal 25 è ora solare, il 29 è UTC+1. */
function orologioA(utc: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(utc));
}

function cassaDice(possibile: boolean | 'cade' | 'aspetta') {
  const chiamate: string[] = [];
  vi.stubGlobal('fetch', (url: unknown) => {
    chiamate.push(String(url));
    if (possibile === 'aspetta') return new Promise(() => {});
    if (possibile === 'cade') return Promise.reject(new Error('rete caduta'));
    return Promise.resolve({ ok: true, json: async () => ({ possibile }) });
  });
  return chiamate;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function nelBrowser(el: ReactElement): Promise<string> {
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    radice.render(createElement(QueryClientProvider, { client }, el));
  });
  // La lettura del negozio e la risposta della cassa arrivano dopo il primo disegno.
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  const testo = nodo.textContent ?? '';
  await act(async () => radice.unmount());
  return testo;
}

const SCHEDE: Array<[string, () => Promise<ReactElement>]> = [
  [
    'la riga dell’elenco dei negozi (app/near)',
    async () => {
      const { default: StoreListRow } = await import('@/components/StoreListRow');
      return createElement(StoreListRow, { store: NEGOZIO as never });
    },
  ],
  [
    'la scheda del negozio nella vetrina della home',
    async () => {
      const { default: StorePreviewCard } = await import('@/components/StorePreviewCard');
      return createElement(StorePreviewCard, { store: NEGOZIO as never, posto: 'scheda-in-vetrina' });
    },
  ],
  [
    'il negozio in evidenza della home',
    async () => {
      const { default: HeroStoreCard } = await import('@/components/home/HeroStoreCard');
      return createElement(HeroStoreCard);
    },
  ],
];

describe.each(SCHEDE)('%s e la consegna di oggi', (_nome, scheda) => {
  it('IL CASO VERO — giovedì 29/10 alle 20:15, forno chiuso dalle 13: niente «consegna oggi»', async () => {
    orologioA('2026-10-29T19:15:00Z');
    cassaDice(true);
    expect(await nelBrowser(await scheda())).not.toMatch(/consegna oggi/i);
  });

  it('giovedì alle 22:00, forno chiuso: niente «consegna oggi»', async () => {
    orologioA('2026-10-29T21:00:00Z');
    cassaDice(true);
    expect(await nelBrowser(await scheda())).not.toMatch(/consegna oggi/i);
  });

  it('giovedì alle 9:00, forno aperto ma senza fattorino: le fasce del pomeriggio cadono, niente «oggi»', async () => {
    orologioA('2026-10-29T08:00:00Z');
    cassaDice(false);
    expect(await nelBrowser(await scheda())).not.toMatch(/consegna oggi/i);
  });

  it('giovedì alle 9:00, forno aperto e la cassa dice sì alla veloce: «consegna oggi»', async () => {
    orologioA('2026-10-29T08:00:00Z');
    const chiamate = cassaDice(true);
    expect(await nelBrowser(await scheda())).toMatch(/consegna oggi/i);
    expect(chiamate.join(' ')).toContain('/api/consegna/veloce?negozi=pane-quotidiano');
  });
});

async function vetrina(): Promise<string> {
  const { default: HeroSection } = await import('@/components/store-sections/HeroSection');
  const ctx = {
    storeId: NEGOZIO.id,
    store: NEGOZIO,
    customization: {},
    accent: '#7C8B5A',
    reviews: [],
    promos: [],
    theme: 'classico',
    site: { sections: [] },
  };
  return nelBrowser(createElement(HeroSection as never, { config: {}, ctx }));
}

describe('la vetrina, mentre la risposta della veloce non c’è', () => {
  it('giovedì alle 9:00 la risposta è ancora in viaggio: non scrive «Consegna domani» per poi dire «oggi»', async () => {
    orologioA('2026-10-29T08:00:00Z');
    cassaDice('aspetta');
    const t = await vetrina();
    expect(t).toContain('Aperto ora');
    expect(t).not.toContain('Consegna domani');
    expect(t).not.toContain('Consegna oggi');
  });

  it('giovedì alle 9:00 la risposta cade: non sa, e non scrive un giorno', async () => {
    orologioA('2026-10-29T08:00:00Z');
    cassaDice('cade');
    const t = await vetrina();
    expect(t).not.toContain('Consegna domani');
    expect(t).not.toContain('Consegna oggi');
  });

  it('giovedì alle 20:15, forno chiuso: la domanda non si fa, e «Consegna domani» resta', async () => {
    orologioA('2026-10-29T19:15:00Z');
    cassaDice('aspetta');
    expect(await vetrina()).toContain('Consegna domani');
  });
});

describe('la veloce resta nelle sue ore anche col negozio aperto la sera', () => {
  it('negozio aperto 8-23, giovedì alle 21:30, un sì vecchio della veloce: «domani», non «oggi»', async () => {
    const { consegnaDellaVetrina, vetrinaChiedeLaVeloce } = await import('@/lib/promessa-consegna');
    const { romeNow } = await import('@/lib/store-hours');
    const alle = (utc: string) => romeNow(new Date(utc));
    expect(consegnaDellaVetrina({ orari: SERA, adesso: alle('2026-10-29T20:30:00Z'), veloce: true })).toBe('domani');
    expect(vetrinaChiedeLaVeloce(SERA, alle('2026-10-29T20:30:00Z'))).toBe(false);
    // Alle 20:30 le fasce di oggi sono finite, ma la veloce si può ancora: il sì vale.
    expect(consegnaDellaVetrina({ orari: SERA, adesso: alle('2026-10-29T19:30:00Z'), veloce: true })).toBe('oggi');
    expect(consegnaDellaVetrina({ orari: FORNO, adesso: alle('2026-10-29T20:30:00Z'), veloce: true })).toBe('domani');
  });
});
